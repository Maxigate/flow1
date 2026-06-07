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
let exporters: Exporter[] = [];
let rrdDatabase: RRDDataPoint[] = [];
let recentFlows: NetFlowRecord[] = [];
let alerts: AnomalyAlert[] = [];


// API - ENGINES: LIVE TRAFFIC FLOW INGESTION ENDPOINT (PRODUCTION)
app.post("/api/flows", (req, res) => {
  const { flows } = req.body;
  if (!flows || !Array.isArray(flows)) {
    return res.status(400).json({ error: "Invalid payload format. Expected { flows: [...] }" });
  }

  const addedFlows: NetFlowRecord[] = [];
  flows.forEach((item: any) => {
    const srcIp = item.srcIp || item.src;
    const dstIp = item.dstIp || item.dst;
    if (!srcIp || !dstIp) return;

    const matchedExporter = exporters.find(e => e.ip === item.exporterIp || e.id === item.exporterId);
    const exporterId = matchedExporter?.id || "exp-external";
    const exporterName = matchedExporter?.name || "Live Collector Inflow";

    // Auto-alerting system based on production thresholds
    let detectedAnomaly = false;
    let anomalyType: 'DDoS Attack' | 'Port Scan' | 'Data Exfiltration' | 'Protocol Drift' | null = null;
    let anomalyDesc = "";
    let severity: 'critical' | 'warning' | 'info' = 'info';

    const packets = parseInt(item.packets || item.pkts) || 1;
    const bytes = parseInt(item.bytes) || 64;
    const proto = (item.proto || "TCP").toUpperCase() as 'TCP' | 'UDP' | 'ICMP' | 'OTHER';
    const srcPort = parseInt(item.srcPort || item.sport) || 0;
    const dstPort = parseInt(item.dstPort || item.dport) || 0;

    // 1. Extreme bandwidth exfiltration rule (e.g., > 100MB in a flow)
    if (bytes > 100 * 1024 * 1024) {
      detectedAnomaly = true;
      anomalyType = "Data Exfiltration";
      severity = "critical";
      anomalyDesc = `High throughput data transfer (${(bytes / 1024 / 1024).toFixed(1)} MB) observed from ${srcIp} to external ${dstIp}.`;
    }
    // 2. High-volume target SYN flood rule (> 1000 packets targeting single port)
    else if (packets > 500 && (item.tcpFlags || "").includes("S")) {
      detectedAnomaly = true;
      anomalyType = "DDoS Attack";
      severity = "critical";
      anomalyDesc = `Potential DDoS attack detected! High packet density (${packets} pkts with SYN flags) from ${srcIp} targeting ${dstIp}:${dstPort}.`;
    }

    const flow: NetFlowRecord = {
      id: "f-" + Math.random().toString(36).substr(2, 9),
      timestamp: item.timestamp || new Date().toISOString(),
      srcIp,
      dstIp,
      srcPort,
      dstPort,
      proto,
      packets,
      bytes,
      tcpFlags: item.tcpFlags || item.flags || "......",
      exporterId,
      exporterName
    };
    recentFlows.unshift(flow);
    addedFlows.push(flow);

    if (matchedExporter) {
      matchedExporter.lastFlowAt = flow.timestamp;
    }

    if (detectedAnomaly && anomalyType) {
      const alert: AnomalyAlert = {
        id: "alt-" + Math.random().toString(36).substr(2, 9),
        timestamp: flow.timestamp,
        type: anomalyType,
        severity,
        description: anomalyDesc,
        sourceIp: srcIp,
        destinationIp: dstIp,
        metrics: {
          bytes,
          packets
        },
        status: "active"
      };
      alerts.unshift(alert);
    }

    // Dynamic RRD database updater
    const timestamp = Math.floor(new Date(flow.timestamp).getTime() / 1000);
    const isLocalDst = dstIp.startsWith("10.") || dstIp.startsWith("192.168.");
    const rx = isLocalDst ? bytes : 0;
    const tx = isLocalDst ? 0 : bytes;

    const lastRrd = rrdDatabase[rrdDatabase.length - 1];
    if (lastRrd && (timestamp - lastRrd.timestamp < 10)) {
      lastRrd.rxBytesSec += rx;
      lastRrd.txBytesSec += tx;
      lastRrd.rxPacketsSec += isLocalDst ? packets : 0;
      lastRrd.txPacketsSec += isLocalDst ? 0 : packets;
      if (proto === "TCP") lastRrd.tcpFlows++;
      else if (proto === "UDP") lastRrd.udpFlows++;
      else if (proto === "ICMP") lastRrd.icmpFlows++;
    } else {
      rrdDatabase.push({
        timestamp,
        formattedTime: new Date(timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        rxBytesSec: rx,
        txBytesSec: tx,
        rxPacketsSec: isLocalDst ? packets : 0,
        txPacketsSec: isLocalDst ? 0 : packets,
        tcpFlows: proto === "TCP" ? 1 : 0,
        udpFlows: proto === "UDP" ? 1 : 0,
        icmpFlows: proto === "ICMP" ? 1 : 0
      });
      if (rrdDatabase.length > 80) rrdDatabase.shift();
    }
  });

  if (recentFlows.length > 1000) {
    recentFlows = recentFlows.slice(0, 1000);
  }

  res.json({ success: true, count: addedFlows.length });
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
