export interface Exporter {
  id: string;
  name: string;
  ip: string;
  port: number;
  version: 'v5' | 'v9' | 'ipfix';
  samplingRate: number;
  status: 'active' | 'inactive';
  addedAt: string;
  lastFlowAt: string | null;
}

export interface NetFlowRecord {
  id: string;
  timestamp: string;
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
  proto: 'TCP' | 'UDP' | 'ICMP' | 'OTHER';
  packets: number;
  bytes: number;
  tcpFlags: string;
  exporterId: string;
  exporterName: string;
}

export interface RRDDataPoint {
  timestamp: number; // Unix epoch of interval
  formattedTime: string;
  rxBytesSec: number;
  txBytesSec: number;
  rxPacketsSec: number;
  txPacketsSec: number;
  tcpFlows: number;
  udpFlows: number;
  icmpFlows: number;
}

export interface AnomalyAlert {
  id: string;
  timestamp: string;
  type: 'DDoS Attack' | 'Port Scan' | 'Data Exfiltration' | 'Protocol Drift';
  severity: 'critical' | 'warning' | 'info';
  description: string;
  sourceIp: string;
  destinationIp: string;
  metrics: {
    bytes?: number;
    packets?: number;
    flowsCount?: number;
    uniquePorts?: number;
  };
  status: 'active' | 'resolved';
}

export interface PHPFileTemplate {
  name: string;
  description: string;
  path: string;
  code: string;
}
