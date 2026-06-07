import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { Exporter, NetFlowRecord, RRDDataPoint, AnomalyAlert, PHPFileTemplate } from "./src/types";

// Setup AI engine safely as per guidelines (lazy initialized or simple check)
let ai: GoogleGenAI | null = null;
try {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY") {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
} catch (e) {
  console.log("Error initializing Gemini API:", e);
}

const app = express();
app.use(express.json());
const PORT = 3000;

// IN-MEMORY STORAGE (Simulates SQLite/File DB)
let exporters: Exporter[] = [
  {
    id: "exp-01",
    name: "Router Core WAN",
    ip: "192.168.100.1",
    port: 9995,
    version: "v9",
    samplingRate: 1,
    status: "active",
    addedAt: "2026-06-06T00:00:00Z",
    lastFlowAt: "2026-06-06T02:33:00Z",
  },
  {
    id: "exp-02",
    name: "Core SW Server Room",
    ip: "10.0.1.254",
    port: 9996,
    version: "v9",
    samplingRate: 100,
    status: "active",
    addedAt: "2026-06-06T01:15:00Z",
    lastFlowAt: "2026-06-06T02:33:10Z",
  },
  {
    id: "exp-03",
    name: "Edge Firewall Lab",
    ip: "172.16.50.1",
    port: 2055,
    version: "ipfix",
    samplingRate: 1,
    status: "inactive",
    addedAt: "2026-06-06T02:00:00Z",
    lastFlowAt: null,
  }
];

let rrdDatabase: RRDDataPoint[] = [];
let recentFlows: NetFlowRecord[] = [];
let alerts: AnomalyAlert[] = [];

// Initialize timeseries data (RRD Emulation)
function initRRD() {
  const now = Math.floor(Date.now() / 1000);
  const fiveMin = 60; // 1-minute steps for detailed demo graphs
  for (let i = 40; i >= 0; i--) {
    const timestamp = now - i * fiveMin;
    const date = new Date(timestamp * 1000);
    // Baseline traffic metrics
    const rxMB = 5 * (1 + Math.sin(i / 1.5)) + Math.random() * 2;
    const txMB = 4 * (1 + Math.cos(i / 2)) + Math.random() * 1.5;
    
    rrdDatabase.push({
      timestamp,
      formattedTime: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      rxBytesSec: Math.floor(rxMB * 1024 * 1024),
      txBytesSec: Math.floor(txMB * 1024 * 1024),
      rxPacketsSec: Math.floor(rxMB * 230),
      txPacketsSec: Math.floor(txMB * 210),
      tcpFlows: Math.floor(rxMB * 4 + txMB * 3),
      udpFlows: Math.floor(rxMB * 2 + 5),
      icmpFlows: Math.floor(Math.random() * 2 + 1),
    });
  }
}
initRRD();

// Generate Random Network Flows (simulates collector nfcapd background threads)
function generateNormalFlows(count = 10) {
  const commonWebIps = ["142.250.191.46", "34.120.45.120", "172.217.16.142", "13.224.23.54", "104.244.42.1"];
  const internalIps = ["10.0.1.15", "10.0.1.22", "192.168.100.12", "192.168.100.45", "10.0.1.60"];
  const serverIps = ["10.0.1.10", "10.0.1.200"]; // DB & Web
  
  const activeExporters = exporters.filter(e => e.status === "active");
  if (activeExporters.length === 0) return;

  const protos: ('TCP' | 'UDP' | 'ICMP')[] = ["TCP", "TCP", "TCP", "UDP", "UDP", "ICMP"];

  for (let i = 0; i < count; i++) {
    const exp = activeExporters[Math.floor(Math.random() * activeExporters.length)];
    const proto = protos[Math.floor(Math.random() * protos.length)];
    let srcIp = "";
    let dstIp = "";
    let srcPort = 0;
    let dstPort = 0;
    let bytes = 0;
    let packets = 0;
    let flags = "......";

    const isOutgoing = Math.random() > 0.4;
    
    if (proto === "TCP") {
      srcPort = Math.floor(Math.random() * 16384) + 49152;
      dstPort = [80, 443, 22, 3306, 8080][Math.floor(Math.random() * 5)];
      
      if (isOutgoing) {
        srcIp = internalIps[Math.floor(Math.random() * internalIps.length)];
        dstIp = commonWebIps[Math.floor(Math.random() * commonWebIps.length)];
      } else {
        srcIp = commonWebIps[Math.floor(Math.random() * commonWebIps.length)];
        dstIp = serverIps[Math.floor(Math.random() * serverIps.length)];
      }
      
      packets = Math.floor(Math.random() * 50) + 1;
      bytes = packets * (Math.floor(Math.random() * 1200) + 64);
      flags = [".A....", ".AP...", ".A...S", ".AP.S."][Math.floor(Math.random() * 4)];
    } else if (proto === "UDP") {
      srcPort = Math.floor(Math.random() * 10000) + 30000;
      dstPort = [53, 123, 161, 443][Math.floor(Math.random() * 4)];
      if (dstPort === 53) {
        srcIp = internalIps[Math.floor(Math.random() * internalIps.length)];
        dstIp = "8.8.8.8";
        packets = 1;
        bytes = Math.floor(Math.random() * 80) + 45;
      } else {
        srcIp = internalIps[Math.floor(Math.random() * internalIps.length)];
        dstIp = commonWebIps[Math.floor(Math.random() * commonWebIps.length)];
        packets = Math.floor(Math.random() * 12) + 1;
        bytes = packets * (Math.floor(Math.random() * 400) + 60);
      }
    } else {
      // ICMP
      srcIp = internalIps[Math.floor(Math.random() * internalIps.length)];
      dstIp = "8.8.8.8";
      srcPort = 0;
      dstPort = 8; // Echo request
      packets = Math.floor(Math.random() * 4) + 1;
      bytes = packets * 64;
    }

    const flow: NetFlowRecord = {
      id: "f-" + Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      srcIp,
      dstIp,
      srcPort,
      dstPort,
      proto: proto === "ICMP" ? "ICMP" : (proto === "TCP" ? "TCP" : "UDP"),
      packets,
      bytes,
      tcpFlags: flags,
      exporterId: exp.id,
      exporterName: exp.name,
    };

    recentFlows.unshift(flow);
    exp.lastFlowAt = flow.timestamp;
  }

  // Cap recent flows capacity
  if (recentFlows.length > 500) {
    recentFlows = recentFlows.slice(0, 500);
  }
}

// Background simulation loop
let simulationInterval = setInterval(() => {
  generateNormalFlows(12);
  
  // Also append to timeseries RRD
  const now = Math.floor(Date.now() / 1000);
  const lastXSecs = recentFlows.slice(0, 15);
  
  let rx = 0;
  let tx = 0;
  let rxPkts = 0;
  let txPkts = 0;
  let tcps = 0;
  let udps = 0;
  let icmps = 0;

  lastXSecs.forEach(f => {
    // Arbitrarily split in/out based on internal destination
    const isLocalDst = f.dstIp.startsWith("10.") || f.dstIp.startsWith("192.168.");
    if (isLocalDst) {
      rx += f.bytes;
      rxPkts += f.packets;
    } else {
      tx += f.bytes;
      txPkts += f.packets;
    }
    if (f.proto === "TCP") tcps++;
    else if (f.proto === "UDP") udps++;
    else icmps++;
  });

  // Keep traffic fluctuations alive
  const amp = 1.0 + Math.random() * 0.4;
  rrdDatabase.push({
    timestamp: now,
    formattedTime: new Date(now * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    rxBytesSec: Math.floor(rx * amp) || Math.floor(2.1 * 1024 * 1024 + Math.random() * 500000),
    txBytesSec: Math.floor(tx * amp) || Math.floor(1.6 * 1024 * 1024 + Math.random() * 400000),
    rxPacketsSec: Math.floor(rxPkts) || Math.floor(120 + Math.random() * 50),
    txPacketsSec: Math.floor(txPkts) || Math.floor(95 + Math.random() * 40),
    tcpFlows: tcps || Math.floor(15 + Math.random() * 10),
    udpFlows: udps || Math.floor(8 + Math.random() * 6),
    icmpFlows: icmps || Math.floor(1 + Math.random() * 3)
  });

  if (rrdDatabase.length > 80) {
    rrdDatabase.shift();
  }
}, 4000);

// TRIGGER MOCK EVENTS / ANOMALIES
app.post("/api/sim/trigger", (req, res) => {
  const { type } = req.body;
  const nowStr = new Date().toISOString();
  let generatedBytes = 0;
  let generatedPackets = 0;
  
  if (type === "ddos") {
    const targetIp = "10.0.1.10";
    const sourceIps = Array.from({length: 40}, (_, i) => `192.0.2.${Math.floor(Math.random() * 254) + 1}`);
    const activeExporters = exporters.filter(e => e.status === "active");
    const exp = activeExporters[0] || exporters[0];

    // Generate heavy flood flows
    for (let i = 0; i < 150; i++) {
      const src = sourceIps[Math.floor(Math.random() * sourceIps.length)];
      const packets = Math.floor(Math.random() * 1000) + 400;
      const bytes = packets * 40; // Small packet SYN flood
      const flow: NetFlowRecord = {
        id: "ddos-" + i + "-" + Math.random().toString(36).substr(2, 5),
        timestamp: nowStr,
        srcIp: src,
        dstIp: targetIp,
        srcPort: Math.floor(Math.random() * 60000) + 2000,
        dstPort: 80,
        proto: "TCP",
        packets,
        bytes,
        tcpFlags: ".....S", // SYN only
        exporterId: exp.id,
        exporterName: exp.name,
      };
      recentFlows.unshift(flow);
      generatedBytes += bytes;
      generatedPackets += packets;
    }

    const alert: AnomalyAlert = {
      id: "alt-" + Math.random().toString(36).substr(2, 9),
      timestamp: nowStr,
      type: "DDoS Attack",
      severity: "critical",
      description: `Detected potential TCP SYN Flood on Webserver (10.0.1.10) with ${generatedPackets} packets from high-volume multiple sources on port 80.`,
      sourceIp: "Various (External Botnet)",
      destinationIp: targetIp,
      metrics: {
        bytes: generatedBytes,
        packets: generatedPackets,
        flowsCount: 150
      },
      status: "active"
    };
    alerts.unshift(alert);

    // Dynamic push of anomalous stats to RRD to show immediate spike
    const rrdNow = Math.floor(Date.now() / 1000);
    const lastRrd = rrdDatabase[rrdDatabase.length - 1];
    if (lastRrd) {
      lastRrd.rxBytesSec += generatedBytes;
      lastRrd.rxPacketsSec += generatedPackets;
      lastRrd.tcpFlows += 150;
    }

    return res.json({ success: true, message: "DDoS attack simulation triggered successfully.", alert });

  } else if (type === "scan") {
    const srcIp = "192.168.100.99";
    const dstIp = "10.0.1.200";
    const activeExporters = exporters.filter(e => e.status === "active");
    const exp = activeExporters[0] || exporters[0];

    // Generate port scanning flows across 60 sequential ports
    for (let p = 20; p <= 120; p++) {
      if (Math.random() > 0.4) continue;
      const flow: NetFlowRecord = {
        id: "scan-" + p + "-" + Math.random().toString(36).substr(2, 5),
        timestamp: nowStr,
        srcIp,
        dstIp,
        srcPort: 52410,
        dstPort: p,
        proto: "TCP",
        packets: 1,
        bytes: 40,
        tcpFlags: ".....S",
        exporterId: exp.id,
        exporterName: exp.name,
      };
      recentFlows.unshift(flow);
      generatedPackets++;
      generatedBytes += 40;
    }

    const alert: AnomalyAlert = {
      id: "alt-" + Math.random().toString(36).substr(2, 9),
      timestamp: nowStr,
      type: "Port Scan",
      severity: "warning",
      description: `Horizontal Port Scan detected from LAN host ${srcIp} pointing to ${dstIp} targeting ports 20-120.`,
      sourceIp: srcIp,
      destinationIp: dstIp,
      metrics: {
        packets: generatedPackets,
        bytes: generatedBytes,
        uniquePorts: 60
      },
      status: "active"
    };
    alerts.unshift(alert);
    return res.json({ success: true, message: "Port Scan simulation triggered.", alert });

  } else if (type === "exfil") {
    const srcIp = "10.0.1.22"; // Sensitive database host
    const dstIp = "203.0.113.88"; // Rogue external host
    const activeExporters = exporters.filter(e => e.status === "active");
    const exp = activeExporters[0] || exporters[0];

    const bytesExfiltrated = 750 * 1024 * 1024; // 750 MB in few packets
    const packets = 520000;

    const flow: NetFlowRecord = {
      id: "exfil-" + Math.random().toString(36).substr(2, 9),
      timestamp: nowStr,
      srcIp,
      dstIp,
      srcPort: 3306,
      dstPort: 443,
      proto: "TCP",
      packets,
      bytes: bytesExfiltrated,
      tcpFlags: ".A.P..",
      exporterId: exp.id,
      exporterName: exp.name,
    };

    recentFlows.unshift(flow);

    const alert: AnomalyAlert = {
      id: "alt-" + Math.random().toString(36).substr(2, 9),
      timestamp: nowStr,
      type: "Data Exfiltration",
      severity: "critical",
      description: `Suspicious data transfer of 750 MB detected from DB Zone (${srcIp}) to unexpected external network (${dstIp}) via TCP 443.`,
      sourceIp: srcIp,
      destinationIp: dstIp,
      metrics: {
        bytes: bytesExfiltrated,
        packets: packets
      },
      status: "active"
    };
    alerts.unshift(alert);

    // Spike the out traffic in RRD
    const lastRrd = rrdDatabase[rrdDatabase.length - 1];
    if (lastRrd) {
      lastRrd.txBytesSec += bytesExfiltrated;
      lastRrd.txPacketsSec += packets;
    }

    return res.json({ success: true, message: "Exfiltration triggered.", alert });
  }

  res.status(400).json({ error: "Invalid anomaly type requested." });
});

// API - EXPORTERS
app.get("/api/exporters", (req, res) => {
  res.json(exporters);
});

app.post("/api/exporters", (req, res) => {
  const { name, ip, port, version, samplingRate } = req.body;
  if (!name || !ip || !port) {
    return res.status(400).json({ error: "Name, IP, and Port are required fields." });
  }
  const newExporter: Exporter = {
    id: "exp-" + Math.random().toString(36).substr(2, 5),
    name,
    ip,
    port: parseInt(port),
    version: version || "v9",
    samplingRate: parseInt(samplingRate) || 1,
    status: "active",
    addedAt: new Date().toISOString(),
    lastFlowAt: null,
  };
  exporters.push(newExporter);
  res.status(201).json(newExporter);
});

app.put("/api/exporters/:id/toggle", (req, res) => {
  const { id } = req.params;
  const exporter = exporters.find(e => e.id === id);
  if (!exporter) {
    return res.status(404).json({ error: "Exporter not found." });
  }
  exporter.status = exporter.status === "active" ? "inactive" : "active";
  res.json(exporter);
});

app.delete("/api/exporters/:id", (req, res) => {
  const { id } = req.params;
  exporters = exporters.filter(e => e.id !== id);
  res.json({ success: true });
});

// API - FLOWS (WITH NFDUMP CLI SIMULATOR PARSER!)
app.get("/api/flows", (req, res) => {
  const { filter, limit } = req.query;
  let matches = [...recentFlows];
  
  const searchLimit = parseInt(limit as string) || 50;

  if (filter && typeof filter === "string" && filter.trim() !== "") {
    const rawFilter = filter.toLowerCase().trim();
    
    // Simple command-line nfdump tokenizer emulation e.g. "proto tcp and port 80"
    // Supports matching: proto, port, src ip, dst ip, host, bytes, packets
    const tokens = rawFilter.split(/\s+and\s+/i);

    matches = matches.filter(flow => {
      return tokens.every(token => {
        const cleaned = token.replace(/['"]/g, "").trim();
        
        // proto match (e.g. "proto tcp")
        if (cleaned.startsWith("proto ")) {
          const protoVal = cleaned.replace("proto ", "").toUpperCase();
          return flow.proto === protoVal;
        }
        
        // port match (src port, dst port, or dual)
        if (cleaned.startsWith("port ")) {
          const portVal = parseInt(cleaned.replace("port ", ""));
          return flow.srcPort === portVal || flow.dstPort === portVal;
        }
        if (cleaned.startsWith("src port ")) {
          const portVal = parseInt(cleaned.replace("src port ", ""));
          return flow.srcPort === portVal;
        }
        if (cleaned.startsWith("dst port ")) {
          const portVal = parseInt(cleaned.replace("dst port ", ""));
          return flow.dstPort === portVal;
        }

        // IP match
        if (cleaned.startsWith("src ip ")) {
          const ipVal = cleaned.replace("src ip ", "");
          return flow.srcIp === ipVal;
        }
        if (cleaned.startsWith("dst ip ")) {
          const ipVal = cleaned.replace("dst ip ", "");
          return flow.dstIp === ipVal;
        }
        if (cleaned.startsWith("host ")) {
          const ipVal = cleaned.replace("host ", "");
          return flow.srcIp === ipVal || flow.dstIp === ipVal;
        }

        // Byte & packet thresholds
        if (cleaned.match(/bytes\s*[><=]\s*\d+/)) {
          const num = parseInt(cleaned.match(/\d+/)![0]);
          if (cleaned.includes(">")) return flow.bytes > num;
          if (cleaned.includes("<")) return flow.bytes < num;
          return flow.bytes === num;
        }
        if (cleaned.match(/packets\s*[><=]\s*\d+/)) {
          const num = parseInt(cleaned.match(/\d+/)![0]);
          if (cleaned.includes(">")) return flow.packets > num;
          if (cleaned.includes("<")) return flow.packets < num;
          return flow.packets === num;
        }

        // Fallback generic search
        return flow.srcIp.includes(cleaned) || 
               flow.dstIp.includes(cleaned) || 
               flow.exporterName.toLowerCase().includes(cleaned) ||
               flow.proto.toLowerCase() === cleaned;
      });
    });
  }

  // Format response both as structured JSON and styled nfdump CLI stdout string
  const slicedMatches = matches.slice(0, searchLimit);
  
  let cliOutput = `nfdump -R /var/netflow/nfcapd -t 2026/06/06.00:00:00-2026/06/06.02:33:48 '${filter || "any"}'\n`;
  cliOutput += `Date flow start          Duration Proto      Src IP Address:Port         Dst IP Address:Port   Packets    Bytes Flags\n`;
  
  let totalBytes = 0;
  let totalPackets = 0;
  
  slicedMatches.forEach(f => {
    const timeFormatted = new Date(f.timestamp).toISOString().replace("T", " ").substring(0, 21);
    const protoStr = f.proto.padEnd(5);
    const srcStr = `${f.srcIp}:${f.srcPort}`.padEnd(28);
    const destStr = `${f.dstIp}:${f.dstPort}`.padEnd(28);
    
    let bytesStr = "";
    if (f.bytes > 1024 * 1024 * 1024) {
      bytesStr = (f.bytes / (1024 * 1024 * 1024)).toFixed(1) + " G";
    } else if (f.bytes > 1024 * 1024) {
      bytesStr = (f.bytes / (1024 * 1024)).toFixed(1) + " M";
    } else if (f.bytes > 1024) {
      bytesStr = (f.bytes / 1024).toFixed(1) + " K";
    } else {
      bytesStr = f.bytes.toString();
    }
    
    cliOutput += `${timeFormatted}     0.410 ${protoStr} ${srcStr}   ->   ${destStr}   ${f.packets.toString().padStart(6)}   ${bytesStr.padStart(8)} ${f.tcpFlags}\n`;
    
    totalBytes += f.bytes;
    totalPackets += f.packets;
  });

  const avgBps = Math.floor((totalBytes * 8) / 10); // Simulated averages
  cliOutput += `------------------------------------------------------------------------------------------------------------------------\n`;
  cliOutput += `Summary: total flows: ${slicedMatches.length}, total bytes: ${(totalBytes / 1024 / 1024).toFixed(2)} MB, total packets: ${totalPackets}, avg bps: ${avgBps} bps\n`;

  res.json({
    flows: slicedMatches,
    cliOutput,
    statistics: {
      totalFlowsMatched: matches.length,
      filteredFlowsReturned: slicedMatches.length,
      totalBytesMatched: totalBytes,
      totalPacketsMatched: totalPackets
    }
  });
});

// API - ALERTS
app.get("/api/alerts", (req, res) => {
  res.json(alerts);
});

app.post("/api/alerts/:id/resolve", (req, res) => {
  const { id } = req.params;
  const alert = alerts.find(a => a.id === id);
  if (alert) {
    alert.status = "resolved";
  }
  res.json({ success: true, alert });
});

// API - RRD HISTOGRAMS & TIME SERIES
app.get("/api/rrd/traffic", (req, res) => {
  res.json({
    database: rrdDatabase,
    // Provide actual rrdtool shell instructions for creating and charting
    templates: {
      createCommand: `rrdtool create traffic.rrd \\
  --step 10 \\
  DS:in_bytes:COUNTER:60:0:U \\
  DS:out_bytes:COUNTER:60:0:U \\
  DS:in_packets:COUNTER:60:0:U \\
  DS:out_packets:COUNTER:60:0:U \\
  RRA:AVERAGE:0.5:1:600 \\
  RRA:AVERAGE:0.5:6:700 \\
  RRA:AVERAGE:0.5:24:775 \\
  RRA:AVERAGE:0.5:288:797`,
      graphCommand: `rrdtool graph netflow_traffic.png \\
  --start -3600 --end now \\
  --title "Traffic Over last 1 hour (RRDtool Generated)" \\
  --vertical-label "Bytes/sec" \\
  --width 700 --height 250 \\
  DEF:in=traffic.rrd:in_bytes:AVERAGE \\
  DEF:out=traffic.rrd:out_bytes:AVERAGE \\
  CDEF:in_bits=in,8,* \\
  CDEF:out_bits=out,8,* \\
  AREA:in_bits#00E500:"Inbound bits/sec" \\
  LINE1.5:out_bits#0000FF:"Outbound bits/sec" \\
  GPRINT:in_bits:MAX:"Max In\\:  %6.2lf %s" \\
  GPRINT:in_bits:AVERAGE:"Avg In\\:  %6.2lf %s" \\
  GPRINT:out_bits:MAX:"Max Out\\: %6.2lf %s" \\
  GPRINT:out_bits:AVERAGE:"Avg Out\\: %6.2lf %s"`
    }
  });
});

// API - RETRIEVE PHP SOURCE FILES & CONFIGS FOR ACTUAL EXPORT/STACK ALIASING!
const phpTemplates: PHPFileTemplate[] = [
  {
    name: "collect.php",
    description: "Background cron script designed to process softflowd flows and load them into RRD Tool",
    path: "/var/www/netflow/collect.php",
    code: `<?php
/**
 * Real Netflow Collector & RRDTool updater bridge setup
 * Run this CLI script via crontab every minute or process nfcapd triggers:
 * * * * * * /usr/bin/php /var/www/netflow/collect.php >> /var/log/netflow_collect.log 2>&1
 */

$rrd_file = '/var/lib/rrdtool/netflow_traffic.rrd';

// Ensure RRD database file exists, configure if not
if (!file_exists($rrd_file)) {
    echo "Creating rrd database at $rrd_file\\n";
    $create_cmd = "rrdtool create $rrd_file --step 60 " .
                  "DS:rx_bytes:COUNTER:120:0:U " .
                  "DS:tx_bytes:COUNTER:120:0:U " .
                  "DS:rx_packets:COUNTER:120:0:U " .
                  "DS:tx_packets:COUNTER:120:0:U " .
                  "RRA:AVERAGE:0.5:1:1440 " . // 1 day high res
                  "RRA:AVERAGE:0.5:5:2016 " .  // 1 week 5-min
                  "RRA:AVERAGE:0.5:30:1488 " . // 1 month 30-min
                  "RRA:AVERAGE:0.5:360:1460";  // 1 year
    exec($create_cmd, $out, $ret);
    if ($ret !== 0) {
        die("Fatal: Could not create RRD file. Verify rrdtool CLI path.\\n");
    }
}

// 1. Capture current cumulative parameters from nfdump summary
// nfdump outputs summary stats of the last 1-minute window
$nfdump_cmd = "/usr/bin/nfdump -R /var/cache/nfdump/ -I";
exec($nfdump_cmd, $output, $return_var);

$rx_bytes = 0;
$tx_bytes = 0;
$rx_packets = 0;
$tx_packets = 0;

// Parse typical raw statistics output of nfdump -I
foreach ($output as $line) {
    if (preg_match('/Total\\s+bytes\\s*:\\s*(\\d+)/i', $line, $matches)) {
        // High-level splits can also be parsed matching specific subnets
        $rx_bytes = $matches[1];
    }
    if (preg_match('/Total\\s+packets\\s*:\\s*(\\d+)/i', $line, $matches)) {
        $rx_packets = $matches[1];
    }
}

// Split estimation for tx / rx based on input interface identifiers
// Update RRD key/value structure
$timestamp = time();
$update_cmd = "rrdtool update $rrd_file $timestamp:$rx_bytes:" . ($rx_bytes * 0.8) . ":$rx_packets:" . ($rx_packets * 0.85);
exec($update_cmd, $up_out, $up_ret);

if ($up_ret === 0) {
    echo "RRD updated successfully with: RX Bytes: $rx_bytes, RX Packets: $rx_packets\\n";
} else {
    echo "Update failed: " . implode("\\n", $up_out) . "\\n";
}
?>`
  },
  {
    name: "graph.php",
    description: "PHP generator for rendering RRD Tool traffic graphs to binary stream outputs",
    path: "/var/www/netflow/graph.php",
    code: `<?php
/**
 * NetFlow RRDTool Graph generator service
 * Called directly in browser: <img src="graph.php?range=hour&metric=bytes" />
 */

header("Content-Type: image/png");

$rrd_file = '/var/lib/rrdtool/netflow_traffic.rrd';
$range = isset($_GET['range']) ? $_GET['range'] : 'hour';
$metric = isset($_GET['metric']) ? $_GET['metric'] : 'bytes';

$time_window = '-3600'; // default 1 hour
if ($range == 'day') $time_window = '-86400';
if ($range == 'week') $time_window = '-604800';
if ($range == 'month') $time_window = '-2592000';

$temp_png = tempnam(sys_get_temp_dir(), 'nfrrd');

$cmd = "rrdtool graph $temp_png --start $time_window --end now --width 640 --height 220 --color CANV#1F2937 --color BACK#111827 --color SHADEA#374151 --color SHADEB#374151 --color FONT#E5E7EB ";

if ($metric == 'packets') {
    $cmd .= "--title 'NetFlow Packet Throughput' --vertical-label 'packets/sec' " .
            "DEF:rx=$rrd_file:rx_packets:AVERAGE " .
            "DEF:tx=$rrd_file:tx_packets:AVERAGE " .
            "AREA:rx#10B981:'Inbound Pkts/s' " .
            "LINE1.5:tx#6366F1:'Outbound Pkts/s' " .
            "GPRINT:rx:MAX:'Max\\:%6.0lf pkts/s' " .
            "GPRINT:rx:AVERAGE:'Avg\\:%6.0lf pkts/s\\\\n' " .
            "GPRINT:tx:MAX:'Max Out\\:%6.0lf pkts/s' " .
            "GPRINT:tx:AVERAGE:'Avg Out\\:%6.0lf pkts/s'";
} else {
    $cmd .= "--title 'NetFlow Bandwidth' --vertical-label 'Bytes/sec' " .
            "DEF:rx=$rrd_file:rx_bytes:AVERAGE " .
            "DEF:tx=$rrd_file:tx_bytes:AVERAGE " .
            "AREA:rx#059669:'Inbound (Bytes)' " .
            "LINE1.5:tx#3B82F6:'Outbound (Bytes)' " .
            "GPRINT:rx:MAX:'Max RX\\:%6.2lf %sB/s' " .
            "GPRINT:rx:AVERAGE:'Avg RX\\:%6.2lf %sB/s\\\\n' " .
            "GPRINT:tx:MAX:'Max TX\\:%6.2lf %sB/s' " .
            "GPRINT:tx:AVERAGE:'Avg TX\\:%6.2lf %sB/s'";
}

exec($cmd, $output, $return_val);

if ($return_val == 0) {
    echo file_get_contents($temp_png);
} else {
    // Generate error image layout
    $im = imagecreatetruecolor(640, 220);
    $text_color = imagecolorallocate($im, 239, 68, 68);
    imagestring($im, 4, 20, 100, "RRDTool execution failed. Verify permissions or commands.", $text_color);
    imagepng($im);
    imagedestroy($im);
}

@unlink($temp_png);
?>`
  },
  {
    name: "nfdump_query.php",
    description: "PHP endpoint wrapper to securely interface with the server's local nfdump daemon executable safely",
    path: "/var/www/netflow/nfdump_query.php",
    code: `<?php
/**
 * nfdump controller script to pass shell filters and export JSON/CLI stream safely
 */
header('Content-Type: application/json');

$allowed_keys = ['proto', 'src', 'dst', 'port', 'bytes', 'packets'];
$filter = isset($_GET['filter']) ? $_GET['filter'] : '';

// Validation pattern matching to prevent OS command Injection
if ($filter !== '') {
    if (preg_match('/[|;&\`\\$\\>\\<]/', $filter)) {
        echo json_encode(['error' => 'Command Injection character detected. Restricted characters: |, ;, &, \`, $, <, >']);
        exit;
    }
}

// Build clean shell command execution wrapper
$bin_path = "/usr/bin/nfdump";
$directory = "/var/cache/netflow/";

$esc_filter = escapeshellarg($filter);
$command = "$bin_path -R $directory $esc_filter -o csv -N -c 100";

exec($command, $output, $return_code);

if ($return_code !== 0) {
    echo json_encode([
        'success' => false,
        'error' => 'nfdump command failed execution.',
        'command_launched' => "$bin_path -R $directory ...",
        'output' => $output
    ]);
    exit;
}

// Parse CSV output cleanly
$records = [];
foreach ($output as $index => $row) {
    if ($index == 0) continue; // skip csv headers
    $cols = str_getcsv($row);
    if (count($cols) < 5) continue;
    $records[] = [
        'start' => $cols[0],
        'proto' => $cols[2],
        'src' => $cols[3],
        'dst' => $cols[4],
        'packets' => $cols[8],
        'bytes' => $cols[9]
    ];
}

echo json_encode([
    'success' => true,
    'raw_count' => count($records),
    'flows' => $records
]);
?>`
  }
];

app.get("/api/php-files", (req, res) => {
  res.json(phpTemplates);
});

// AI INSIGHT GENERATOR USING GEMINI SDK
app.post("/api/ai/analytics", async (req, res) => {
  const { alertContext } = req.body;
  if (!ai) {
    return res.json({
      insight: "O Gemini AI está operando em modo offline. Configure a variável dfe ambiente GEMINI_API_KEY no painel de segredos do AI Studio para habilitar relatórios automatizados de resposta a incidentes de rede em tempo real baseados em IA Intel."
    });
  }

  try {
    const textPrompt = `Você é um Engenheiro SRE / Administrador de Redes Sênior especialista em NetFlow, nfdump e segurança de infraestrutura de roteamento.
Analise a seguinte ameaça/anomalia NetFlow detectada pelo nosso sistema e forneça um relatório conciso contendo:
1. Explicação técnica fácil de entender do ataque detectado.
2. Comandos recomendados de 'nfdump' para depurar ou filtrar este tráfego rasteiro nos arquivos de captura acumulados (/var/cache/netflow/nfcapd.*).
3. Regras de firewall preventivas imediatas (ex: iptables, Cisco ACL, ou Mikrotik Firewall Rule) para mitigar a anomalia.

Detecção:
${JSON.stringify(alertContext, null, 2)}

Responda em PORTUGUÊS de forma extremamente profissional, organizada, e estruturada em tópicos limpos.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: textPrompt,
    });

    res.json({ insight: response.text });
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    res.json({
      insight: "Erro ao consultar o Gemini AI: " + (error?.message || error) + "\n\nExemplo de mitigação alternativa: Bloqueie a porta atacada no firewall de borda WAN usando 'iptables -A INPUT -p tcp --dport 80 -m limit --limit 25/minute -j ACCEPT'"
    });
  }
});

// Serve Vite dev server static falls
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[NetFlow Server] Running on port ${PORT}`);
  });
}

startServer();
