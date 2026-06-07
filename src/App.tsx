import React, { useState, useEffect } from "react";
import {
  Network,
  Activity,
  Terminal as TerminalIcon,
  Settings,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Trash2,
  Play,
  RefreshCw,
  Cpu,
  FileCode,
  Lightbulb,
  Wifi,
  WifiOff,
  Database,
  ShieldAlert,
  HelpCircle,
  Copy,
  Check,
  Search,
  Filter,
  BarChart3,
  Flame,
  ArrowDownLeft,
  ArrowUpRight
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  LineChart,
  Line,
  BarChart,
  Bar
} from "recharts";
import { Exporter, NetFlowRecord, RRDDataPoint, AnomalyAlert, PHPFileTemplate } from "./types";

export default function App() {
  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<"dashboard" | "exporters" | "nfdump" | "php">("dashboard");

  // Core States
  const [exporters, setExporters] = useState<Exporter[]>([]);
  const [recentFlows, setRecentFlows] = useState<NetFlowRecord[]>([]);
  const [rrdData, setRrdData] = useState<RRDDataPoint[]>([]);
  const [alerts, setAlerts] = useState<AnomalyAlert[]>([]);
  const [phpFiles, setPhpFiles] = useState<PHPFileTemplate[]>([]);
  
  // RRD Commands config
  const [rrdCreateCmd, setRrdCreateCmd] = useState("");
  const [rrdGraphCmd, setRrdGraphCmd] = useState("");

  // nfdump Terminal simulator state
  const [nfdumpFilter, setNfdumpFilter] = useState("proto TCP");
  const [nfdumpOutput, setNfdumpOutput] = useState("");
  const [nfdumpLoading, setNfdumpLoading] = useState(false);
  const [limitCount, setLimitCount] = useState(25);

  // New Exporter Form State
  const [newExporterName, setNewExporterName] = useState("");
  const [newExporterIp, setNewExporterIp] = useState("");
  const [newExporterPort, setNewExporterPort] = useState(9995);
  const [newExporterVersion, setNewExporterVersion] = useState<'v5' | 'v9' | 'ipfix'>("v9");
  const [newExporterSampling, setNewExporterSampling] = useState(1);

  // Gemini AI Analysis Modal/Section state
  const [analyzingAlert, setAnalyzingAlert] = useState<AnomalyAlert | null>(null);
  const [aiInsight, setAiInsight] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  // Auto-refresh poll state
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  
  // UI helper indicators
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Load Data function
  const fetchData = async () => {
    try {
      const expRes = await fetch("/api/exporters");
      const exportersList = await expRes.json();
      setExporters(exportersList);

      const rrdRes = await fetch("/api/rrd/traffic");
      const rrdInfo = await rrdRes.json();
      setRrdData(rrdInfo.database);
      setRrdCreateCmd(rrdInfo.templates.createCommand);
      setRrdGraphCmd(rrdInfo.templates.graphCommand);

      const alertsRes = await fetch("/api/alerts");
      const alertsList = await alertsRes.json();
      setAlerts(alertsList);

      // Trigger automatic flows dump on current filter
      await runNfdumpQuery(nfdumpFilter, limitCount, false);

      setLastRefreshedAt(new Date());
    } catch (err) {
      console.error("Unable to execute API retrieval", err);
    }
  };

  // Run nfdump query
  const runNfdumpQuery = async (filterText: string, limitValue: number, setLoader = true) => {
    if (setLoader) setNfdumpLoading(true);
    try {
      const res = await fetch(`/api/flows?filter=${encodeURIComponent(filterText)}&limit=${limitValue}`);
      const data = await res.json();
      setRecentFlows(data.flows);
      setNfdumpOutput(data.cliOutput);
    } catch (err) {
      setNfdumpOutput("nfdump: Connection to collector sockets refused.");
    } finally {
      if (setLoader) setNfdumpLoading(false);
    }
  };

  // Fetch PHP templates and initial datasets
  useEffect(() => {
    fetchData();
    
    // Fetch PHPs once
    fetch("/api/php-files")
      .then(r => r.json())
      .then(data => setPhpFiles(data))
      .catch(e => console.error(e));
  }, []);

  // Set up polling loop
  useEffect(() => {
    if (!autoRefresh) return;
    const intv = setInterval(() => {
      fetchData();
    }, 5000);
    return () => clearInterval(intv);
  }, [autoRefresh, nfdumpFilter, limitCount]);

  // Form Submission handles exporter registration
  const handleAddExporter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExporterName || !newExporterIp) return;
    
    try {
      const res = await fetch("/api/exporters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newExporterName,
          ip: newExporterIp,
          port: newExporterPort,
          version: newExporterVersion,
          samplingRate: newExporterSampling
        })
      });
      if (res.ok) {
        setNewExporterName("");
        setNewExporterIp("");
        setNewExporterPort(9995);
        setNewExporterSampling(1);
        fetchData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Toggle status of exporter
  const toggleExporter = async (id: string) => {
    try {
      await fetch(`/api/exporters/${id}/toggle`, { method: "PUT" });
      fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  // Delete exporter
  const deleteExporter = async (id: string) => {
    if (!confirm("Deseja realmente remover este exportador de NetFlow?")) return;
    try {
      await fetch(`/api/exporters/${id}`, { method: "DELETE" });
      fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  // Resolve alert
  const resolveAlert = async (id: string) => {
    try {
      await fetch(`/api/alerts/${id}/resolve`, { method: "POST" });
      fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  // Consult Gemini API for Incident mitigation
  const analyzeWithGemini = async (alert: AnomalyAlert) => {
    setAiLoading(true);
    setAiInsight("");
    try {
      const res = await fetch("/api/ai/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertContext: alert })
      });
      const data = await res.json();
      setAiInsight(data.insight);
    } catch (err) {
      setAiInsight("Erro ao contactar o copiloto de segurança de IA.");
    } finally {
      setAiLoading(false);
    }
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const formatBytes = (bytesSec: number) => {
    if (bytesSec > 1024 * 1024) return (bytesSec / (1024 * 1024)).toFixed(2) + " MB/s";
    if (bytesSec > 1024) return (bytesSec / 1024).toFixed(2) + " KB/s";
    return bytesSec + " B/s";
  };

  // Quick Preset Filters
  const filterPresets = [
    { label: "Todos TCP", query: "proto TCP" },
    { label: "Erros SYN Flood", query: "proto TCP and bytes < 120" },
    { label: "Todo tráfego UDP", query: "proto UDP" },
    { label: "Porta DNS Local (53)", query: "port 53" },
    { label: "IP do Servidor Web", query: "host 10.0.1.10" },
    { label: "Alta Volumetria (>50KB)", query: "bytes > 50000" }
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-slate-950">
      
      {/* GLOBAL HEADER */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-30 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-emerald-600 to-sky-600 p-2 rounded-lg text-white shadow-lg ring-2 ring-emerald-500/20">
            <Network className="w-6 h-6 animate-pulse" id="header-logo-icon" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-white flex items-center gap-2">
              NetFlow Monitor <span className="text-xs bg-slate-800 border border-slate-700 text-slate-400 px-2 py-0.5 rounded-full font-mono">nfdump + rrdtool</span>
            </h1>
            <p className="text-xs text-slate-400">Coletor NetFlow v5/v9 & Analisador de Tráfego de Alta Fidelidade</p>
          </div>
        </div>

        {/* REFRESH CONTROL & CONNECTIONS */}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-md">
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${autoRefresh ? "bg-emerald-400" : "bg-amber-400"}`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${autoRefresh ? "bg-emerald-500" : "bg-amber-500"}`}></span>
            </span>
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className="font-medium hover:text-emerald-400 Transition cursor-pointer"
            >
              Autopush: {autoRefresh ? "LIGADO (5s)" : "PAUSADO"}
            </button>
          </div>

          <button
            onClick={() => {
              fetchData();
              runNfdumpQuery(nfdumpFilter, limitCount);
            }}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-800 border border-slate-700 px-2.5 py-1.5 rounded-md transition font-medium cursor-pointer"
            title="Atualizar dados manualmente"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Recarregar
          </button>
          
          <div className="text-slate-500 hidden sm:block">
            Última sync: {lastRefreshedAt.toLocaleTimeString()}
          </div>
        </div>
      </header>

      {/* CORE NAVIGATION BOARD */}
      <div className="bg-slate-900 border-b border-slate-800 px-6 py-1">
        <nav className="flex space-x-1" aria-label="Tabs">
          <button
            onClick={() => setActiveTab("dashboard")}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition flex items-center gap-2 cursor-pointer ${
              activeTab === "dashboard"
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700"
            }`}
          >
            <Activity className="w-4 h-4" />
            Painel Geral
          </button>
          <button
            onClick={() => setActiveTab("exporters")}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition flex items-center gap-2 cursor-pointer ${
              activeTab === "exporters"
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700"
            }`}
          >
            <Settings className="w-4 h-4" />
            Exportadores ({exporters.length})
          </button>
          <button
            onClick={() => setActiveTab("nfdump")}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition flex items-center gap-2 cursor-pointer ${
              activeTab === "nfdump"
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700"
            }`}
          >
            <TerminalIcon className="w-4 h-4" />
            Terminal nfdump
          </button>
          <button
            onClick={() => setActiveTab("php")}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition flex items-center gap-2 cursor-pointer ${
              activeTab === "php"
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700"
            }`}
          >
            <FileCode className="w-4 h-4" />
            Integração PHP + RRDtool
          </button>
        </nav>
      </div>

      {/* CENTRAL SCENARIO RUNNER PANEL (STAYS IN FLOWS / ALERTS SECTION) */}
      <main className="flex-1 p-6 overflow-y-auto max-w-[1700px] w-full mx-auto space-y-6">
        
        {/* TAB 1: DASHBOARD TELEMETRY PANEL */}
        {activeTab === "dashboard" && (
          <div className="space-y-6">
            
            {/* METRICS ROW CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider block">Tráfego de Entrada</span>
                  <span className="text-2xl font-bold font-mono text-emerald-400 mt-1 block">
                    {rrdData.length > 0 ? formatBytes(rrdData[rrdData.length - 1].rxBytesSec) : "0 B/s"}
                  </span>
                  <span className="text-slate-400 text-xs mt-1 flex items-center gap-1">
                    <ArrowDownLeft className="text-emerald-500 w-3 h-3" />
                    Banda Inbound do Gateway
                  </span>
                </div>
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
                  <Database className="w-6 h-6" />
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider block">Tráfego de Saída</span>
                  <span className="text-2xl font-bold font-mono text-sky-400 mt-1 block">
                    {rrdData.length > 0 ? formatBytes(rrdData[rrdData.length - 1].txBytesSec) : "0 B/s"}
                  </span>
                  <span className="text-slate-400 text-xs mt-1 flex items-center gap-1">
                    <ArrowUpRight className="text-sky-500 w-3 h-3" />
                    Banda Outbound do Gateway
                  </span>
                </div>
                <div className="p-3 bg-sky-500/10 border border-sky-500/20 rounded-lg text-sky-400">
                  <Cpu className="w-6 h-6" />
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider block">Conexões Ativas (Fluxos)</span>
                  <span className="text-2xl font-bold font-mono text-amber-400 mt-1 block">
                    {rrdData.length > 0 ? rrdData[rrdData.length - 1].tcpFlows + rrdData[rrdData.length - 1].udpFlows : 0} /s
                  </span>
                  <span className="text-slate-400 text-xs mt-1 block font-mono text-[10px]">
                    TCP: {rrdData.length > 0 ? rrdData[rrdData.length - 1].tcpFlows : 0} | UDP: {rrdData.length > 0 ? rrdData[rrdData.length - 1].udpFlows : 0}
                  </span>
                </div>
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400">
                  <Activity className="w-6 h-6" />
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider block">Alertas de Segurança</span>
                  <span className="text-2xl font-bold font-mono text-rose-500 mt-1 block flex items-center gap-2">
                    {alerts.filter(a => a.status === "active").length} ativos
                    {alerts.filter(a => a.status === "active").length > 0 && (
                      <span className="flex h-2 w-2 rounded-full bg-rose-500 animate-ping"></span>
                    )}
                  </span>
                  <span className="text-slate-400 text-xs mt-1 block">
                    Anomalias capturadas no NetFlow
                  </span>
                </div>
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-500">
                  <ShieldAlert className="w-6 h-6" />
                </div>
              </div>
            </div>

            {/* MAIN TWO-COLUMN SUBSECTION */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* TELEMETRY CHARTS AND SIMULATOR (LEFT - 2 COLS) */}
              <div className="lg:col-span-2 space-y-6">
                
                {/* RRDTOOL TRAFFIC TELEMETRY CHART */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6">
                    <div>
                      <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                        <BarChart3 className="text-emerald-400 w-5 h-5" />
                        Gráficos RRDtool: Volumetria em Tempo Real (Byte Rate)
                      </h2>
                      <p className="text-xs text-slate-400">Amostragem RRD atualizada baseada nos contadores DERIVED do NetFlow</p>
                    </div>
                    <div className="mt-2 sm:mt-0 flex items-center gap-2">
                      <span className="text-xs px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded font-mono font-bold">RRD database: OK</span>
                    </div>
                  </div>

                  {/* CHARTS CONTAINER */}
                  <div className="h-72 w-full">
                    {rrdData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={rrdData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                          <defs>
                            <linearGradient id="rxColor" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                            </linearGradient>
                            <linearGradient id="txColor" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                          <XAxis dataKey="formattedTime" stroke="#64748b" fontSize={10} minTickGap={15} />
                          <YAxis 
                            stroke="#64748b" 
                            fontSize={10} 
                            tickFormatter={(value) => `${(value / (1024 * 1024)).toFixed(1)} MB/s`}
                          />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '8px' }}
                            labelStyle={{ color: '#94a3b8', fontSize: '10px' }}
                            itemStyle={{ color: '#f1f5f9', fontSize: '12px' }}
                            formatter={(value: any) => [formatBytes(Number(value)), "Taxa"]}
                          />
                          <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                          <Area type="monotone" dataKey="rxBytesSec" name="RX Entrada (Bits)" stroke="#10b981" strokeWidth={1.5} fillOpacity={1} fill="url(#rxColor)" />
                          <Area type="monotone" dataKey="txBytesSec" name="TX Saída (Bits)" stroke="#0ea5e9" strokeWidth={1.5} fillOpacity={1} fill="url(#txColor)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-full text-slate-500">
                        Carregando registros do arquivo RRD...
                      </div>
                    )}
                  </div>
                </div>

                {/* FLOW INTENSITY RATIO (LINE / SPEED CONTROLLERS) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  
                  {/* PACKET RATE GRAPH */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-xs">
                    <h3 className="font-semibold text-white mb-2 flex items-center gap-2">
                      <Activity className="w-4 h-4 text-sky-400" />
                      Taxa de Pacotes (Packets/Sec)
                    </h3>
                    <div className="h-44 w-full">
                      {rrdData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={rrdData}>
                            <CartesianGrid strokeDasharray="2 2" stroke="#1e293b" />
                            <XAxis dataKey="formattedTime" stroke="#475569" fontSize={8} tickLine={false} />
                            <YAxis stroke="#475569" fontSize={8} tickLine={false} />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b' }}
                              itemStyle={{ fontSize: '10px' }}
                            />
                            <Line type="monotone" dataKey="rxPacketsSec" name="RX Pkts" stroke="#10b981" strokeWidth={1.5} dot={false} />
                            <Line type="monotone" dataKey="txPacketsSec" name="TX Pkts" stroke="#f43f5e" strokeWidth={1.5} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex items-center justify-center h-full text-slate-600">Alimentando RRD...</div>
                      )}
                    </div>
                  </div>

                  {/* PROTOCOL PROFILE IN-FLOWS */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-xs">
                    <h3 className="font-semibold text-white mb-2 flex items-center gap-2">
                      <Database className="w-4 h-4 text-purple-400" />
                      Tipos de Protocolo Registrados por Segundo
                    </h3>
                    <div className="h-44 w-full">
                      {rrdData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={rrdData}>
                            <CartesianGrid strokeDasharray="2 2" stroke="#1e293b" />
                            <XAxis dataKey="formattedTime" stroke="#475569" fontSize={8} tickLine={false} />
                            <YAxis stroke="#475569" fontSize={8} tickLine={false} />
                            <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b' }} itemStyle={{ fontSize: '10px' }} />
                            <Legend wrapperStyle={{ fontSize: '9px' }} />
                            <Bar dataKey="tcpFlows" name="TCP" stackId="a" fill="#3b82f6" />
                            <Bar dataKey="udpFlows" name="UDP" stackId="a" fill="#a855f7" />
                            <Bar dataKey="icmpFlows" name="ICMP" stackId="a" fill="#eab308" />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex items-center justify-center h-full text-slate-600">Alimentando RRD...</div>
                      )}
                    </div>
                  </div>
                </div>



              </div>

              {/* LIVE SECURITY ANOMALIES & ALERTS SECTION (RIGHT - 1 COL) */}
              <div className="lg:col-span-1 space-y-6">
                
                {/* ACTIVE THREATS BOARD */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col h-full max-h-[850px]">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-semibold text-white flex items-center gap-2">
                      <ShieldAlert className="w-5 h-5 text-rose-500" />
                      Quadro de Anomalias de Rede
                    </h3>
                    <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full font-mono">
                      {alerts.filter(a => a.status === "active").length} alertas
                    </span>
                  </div>

                  {/* ACTIVE ALERTS LIST */}
                  <div className="space-y-4 overflow-y-auto flex-1 pr-1">
                    {alerts.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-3" />
                        <span className="font-semibold text-slate-300 text-sm">Nenhuma anomalia ativa</span>
                        <p className="text-xs text-slate-500 mt-1 max-w-[200px]">Os coletores de influxo de rede não identificaram assinaturas de exfiltração ou spamport.</p>
                      </div>
                    ) : (
                      alerts.map((alert) => (
                        <div
                          key={alert.id}
                          className={`p-4 rounded-xl border transition ${
                            alert.status === "resolved"
                              ? "bg-slate-950/40 border-slate-800 opacity-60"
                              : alert.severity === "critical"
                              ? "bg-rose-950/20 border-rose-900/50 hover:bg-rose-950/30"
                              : "bg-amber-950/20 border-amber-900/50 hover:bg-amber-950/30"
                          }`}
                        >
                          <div className="flex justify-between items-start gap-1">
                            <span className={`text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full ${
                              alert.status === "resolved"
                                ? "bg-slate-800 text-slate-400"
                                : alert.severity === "critical"
                                ? "bg-rose-900/40 text-rose-400"
                                : "bg-amber-900/40 text-amber-400"
                            }`}>
                              [{alert.severity}] - {alert.type}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {new Date(alert.timestamp).toLocaleTimeString()}
                            </span>
                          </div>

                          <p className="text-xs text-slate-300 font-semibold mt-2 leading-relaxed">
                            {alert.description}
                          </p>

                          <div className="bg-slate-950/60 rounded p-2 mt-3 space-y-1 text-[10px] font-mono text-slate-400 border border-slate-900">
                            <div>Origem: <span className="text-white font-semibold">{alert.sourceIp}</span></div>
                            <div>Destino: <span className="text-white font-semibold">{alert.destinationIp}</span></div>
                            {alert.metrics.bytes && (
                              <div>Bytes Detectados: <span className="text-emerald-400 font-semibold">{formatBytes(alert.metrics.bytes)}</span></div>
                            )}
                            {alert.metrics.packets && (
                              <div>Total de Pacotes: <span className="text-sky-400 font-semibold">{alert.metrics.packets}</span></div>
                            )}
                          </div>

                          {/* ACTION ACTIONS FOR INCIDENTS */}
                          <div className="mt-4 flex gap-2 justify-end">
                            {alert.status === "active" && (
                              <button
                                onClick={() => resolveAlert(alert.id)}
                                className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium px-3 py-1.5 rounded transition cursor-pointer"
                              >
                                Resolver Alerta
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setAnalyzingAlert(alert);
                                analyzeWithGemini(alert);
                              }}
                              className="text-[11px] bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-3 py-1.5 rounded transition flex items-center gap-1 cursor-pointer"
                            >
                              <Lightbulb className="w-3.5 h-3.5" />
                              Análise Copiloto IA
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              </div>

            </div>

            {/* LIVE FLOWS LOG PANEL AT THE BOTTOM OF THE DASHBOARD */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-2">
                <div>
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    <Database className="w-5 h-5 text-emerald-500" />
                    Fluxos NetFlow Ativos Monitorados (Buffer do Coletor)
                  </h3>
                  <p className="text-xs text-slate-400">Dados puros decodificados diretamente do soquete UDP de escuta do roteador (nfcapd/softflowd)</p>
                </div>
                <button
                  onClick={() => setActiveTab("nfdump")}
                  className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <TerminalIcon className="w-4 h-4" />
                  Mais filtros avançados no CLI
                </button>
              </div>

              <div className="overflow-x-auto border border-slate-800 rounded-lg">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 border-b border-slate-800 font-mono text-[11px] uppercase tracking-wider">
                      <th className="p-3">Hora de Início</th>
                      <th className="p-3">Protocolo</th>
                      <th className="p-3">Origem (IP:Porta)</th>
                      <th className="p-3">Destino (IP:Porta)</th>
                      <th className="p-3 text-right">Pacotes</th>
                      <th className="p-3 text-right">Bytes</th>
                      <th className="p-3">Flags TCP</th>
                      <th className="p-3">Exportador</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 font-mono text-[11px]">
                    {recentFlows.slice(0, 8).map((flow) => {
                      const isHot = flow.bytes > 500000;
                      return (
                        <tr key={flow.id} className="hover:bg-slate-900/50 transition">
                          <td className="p-3 text-slate-500">
                            {new Date(flow.timestamp).toLocaleTimeString()}
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                              flow.proto === "TCP" 
                                ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" 
                                : flow.proto === "UDP"
                                ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                                : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                            }`}>
                              {flow.proto}
                            </span>
                          </td>
                          <td className="p-3 text-slate-300 font-semibold">{flow.srcIp}:{flow.srcPort}</td>
                          <td className="p-3 text-slate-300 font-semibold">{flow.dstIp}:{flow.dstPort}</td>
                          <td className="p-3 text-right text-slate-400">{flow.packets.toLocaleString()}</td>
                          <td className={`p-3 text-right font-bold ${isHot ? "text-amber-400 scale-105" : "text-emerald-400"}`}>
                            {flow.bytes > 1024 * 1024 
                              ? (flow.bytes / (1024 * 1024)).toFixed(1) + " MB"
                              : flow.bytes > 1024 
                              ? (flow.bytes / 1024).toFixed(1) + " KB"
                              : flow.bytes + " B"
                            }
                          </td>
                          <td className="p-3 text-slate-500 font-mono tracking-widest">{flow.tcpFlags}</td>
                          <td className="p-3 text-slate-400 text-xs italic">{flow.exporterName}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* TAB 2: EXPORTERS MANAGEMENT MENU */}
        {activeTab === "exporters" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* REGISTER NEW EXPORTER FORM (LEFT - 1 COL) */}
            <div className="lg:col-span-1">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
                <h3 className="font-semibold text-white mb-2 flex items-center gap-2 text-md">
                  <Plus className="w-5 h-5 text-emerald-500" />
                  Cadastrar Novo Exportador NetFlow
                </h3>
                <p className="text-xs text-slate-400 mb-6 font-normal">
                  Insira as configurações de roteadores ou firewalls autorizados a enviar dados do fluxograma NetFlow (UDP) ao coletor.
                </p>

                <form onSubmit={handleAddExporter} className="space-y-4 text-xs">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1.5" htmlFor="exporter-name">Nome do Dispositivo</label>
                    <input
                      id="exporter-name"
                      type="text"
                      required
                      placeholder="Ex: Roteador Cisco Borda HQ"
                      value={newExporterName}
                      onChange={(e) => setNewExporterName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-emerald-500 px-3 py-2 rounded-lg text-slate-100 placeholder-slate-600 outline-none transition"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1.5" htmlFor="exporter-ip">IP Address (IPv4/IPv6)</label>
                    <input
                      id="exporter-ip"
                      type="text"
                      required
                      placeholder="Ex: 192.168.1.254"
                      value={newExporterIp}
                      onChange={(e) => setNewExporterIp(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-emerald-500 px-3 py-2 rounded-lg text-slate-100 placeholder-slate-600 outline-none transition font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-300 font-medium mb-1.5" htmlFor="exporter-port">Porta de Escuta UDP</label>
                      <input
                        id="exporter-port"
                        type="number"
                        required
                        placeholder="9995"
                        value={newExporterPort}
                        onChange={(e) => setNewExporterPort(parseInt(e.target.value) || 9995)}
                        className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-emerald-500 px-3 py-2 rounded-lg text-slate-100 outline-none transition font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-300 font-medium mb-1.5" htmlFor="exporter-version">Versão do Fluxo</label>
                      <select
                        id="exporter-version"
                        value={newExporterVersion}
                        onChange={(e) => setNewExporterVersion(e.target.value as any)}
                        className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-emerald-500 px-3 py-2 rounded-lg text-slate-100 outline-none transition"
                      >
                        <option value="v5">NetFlow v5 (Legacy)</option>
                        <option value="v9">NetFlow v9 (Standard)</option>
                        <option value="ipfix">IPFIX (Protocolo Aberto)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1" htmlFor="exporter-sampling">Taxa de Amostragem (Sampling Rate)</label>
                    <span className="text-[10px] text-slate-500 block mb-1.5">Configure 1 para captura total de pacotes, ou maior que 100 para roteadores em alta escala.</span>
                    <input
                      id="exporter-sampling"
                      type="number"
                      required
                      placeholder="1"
                      min="1"
                      value={newExporterSampling}
                      onChange={(e) => setNewExporterSampling(parseInt(e.target.value) || 1)}
                      className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-emerald-500 px-3 py-2 rounded-lg text-slate-100 outline-none transition font-mono"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-semibold py-2.5 rounded-lg transition mt-4 cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    Registrar Dispositivo
                  </button>
                </form>
              </div>
            </div>

            {/* EXPORTER DEVICES TABLE (RIGHT - 2 COLS) */}
            <div className="lg:col-span-2">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm text-xs">
                <h3 className="font-semibold text-white mb-2 flex items-center gap-2 text-md">
                  <Network className="w-5 h-5 text-emerald-500" />
                  Roteadores e Agentes Exportadores Conectados
                </h3>
                <p className="text-xs text-slate-400 mb-6 font-normal">
                  Visão geral de todas as fontes habilitadas. Pacotes recebidos de IPs desconhecidos são descartados automaticamente pelo daemon do coletor.
                </p>

                <div className="overflow-x-auto border border-slate-800 rounded-lg">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-950 text-slate-400 border-b border-slate-800 font-mono text-[10px] uppercase tracking-wider">
                        <th className="p-3">Nome / Localização</th>
                        <th className="p-3">IP Address</th>
                        <th className="p-3">Porta UDP</th>
                        <th className="p-3">Versão</th>
                        <th className="p-3">Sampling Rate</th>
                        <th className="p-3">Status Coleta</th>
                        <th className="p-3 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 font-mono">
                      {exporters.map((exp) => (
                        <tr key={exp.id} className="hover:bg-slate-900/50 transition">
                          <td className="p-3 font-semibold text-slate-200">{exp.name}</td>
                          <td className="p-3 text-slate-400 font-mono">{exp.ip}</td>
                          <td className="p-3 text-slate-300 font-mono">{exp.port}</td>
                          <td className="p-3">
                            <span className="bg-slate-800 border border-slate-700 text-slate-300 px-2 py-0.5 rounded-md font-mono font-bold text-[9px] uppercase">
                              {exp.version}
                            </span>
                          </td>
                          <td className="p-3 text-slate-300">1 : {exp.samplingRate}</td>
                          <td className="p-3">
                            <button
                              onClick={() => toggleExporter(exp.id)}
                              className={`px-2 py-1 rounded-full text-[10px] font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                                exp.status === "active"
                                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                  : "bg-slate-800 text-slate-500 border border-transparent"
                              }`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${exp.status === "active" ? "bg-emerald-500" : "bg-slate-500"}`}></span>
                              {exp.status === "active" ? "Escutando" : "Pausado"}
                            </button>
                          </td>
                          <td className="p-3 text-right">
                            <button
                              onClick={() => deleteExporter(exp.id)}
                              className="text-slate-500 hover:text-rose-400 p-1 rounded-md transition cursor-pointer"
                              title="Remover exportador"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* TAB 3: NFDUMP TERMINAL SIMULATOR */}
        {activeTab === "nfdump" && (
          <div className="space-y-6">
            
            {/* TERMINAL RUNNER BLOCK */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm text-xs">
              <div className="flex items-center gap-2 mb-2">
                <TerminalIcon className="w-5 h-5 text-emerald-500" />
                <h3 className="text-md font-semibold text-white">Análise nfdump Interativa (Terminal Parser)</h3>
              </div>
              <p className="text-xs text-slate-400 mb-6 font-normal">
                Faça varreduras nos registros e fluxos NetFlow consolidados no banco binário (/var/cache/netflow/nfcapd.*). Utilize a sintaxe do utilitário <code className="bg-slate-950 px-1.5 py-0.5 rounded font-mono text-emerald-300">nfdump</code> com filtros do tipo tcpdump.
              </p>

              {/* FILTER CONSTRUCTS PANEL */}
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                
                {/* TOOLBAR CONTROLS (LEFT - 1 COL) */}
                <div className="lg:col-span-1 space-y-4 bg-slate-950/40 p-4 border border-slate-800/80 rounded-xl">
                  <h4 className="font-semibold text-white text-xs mb-1 flex items-center gap-1">
                    <Filter className="w-3.5 h-3.5 text-sky-400" />
                    Atalhos de Filtros Rápidos
                  </h4>
                  <div className="space-y-2 flex flex-col">
                    {filterPresets.map((preset) => (
                      <button
                        key={preset.label}
                        onClick={() => {
                          setNfdumpFilter(preset.query);
                          runNfdumpQuery(preset.query, limitCount);
                        }}
                        className={`text-left text-xs p-2.5 rounded-lg border transition cursor-pointer font-medium ${
                          nfdumpFilter === preset.query
                            ? "bg-emerald-950/20 border-emerald-500 text-emerald-300"
                            : "bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-300 hover:bg-slate-800/80"
                        }`}
                      >
                        <div className="font-bold text-[10px] uppercase text-emerald-400 mb-0.5">{preset.label}</div>
                        <div className="font-mono text-[9px] overflow-hidden text-ellipsis whitespace-nowrap">{preset.query}</div>
                      </button>
                    ))}
                  </div>

                  <div className="pt-2">
                    <label className="block text-slate-400 font-semibold mb-1" htmlFor="records-limit">Limite de Registros</label>
                    <select
                      id="records-limit"
                      value={limitCount}
                      onChange={(e) => {
                        const newLimit = parseInt(e.target.value);
                        setLimitCount(newLimit);
                        runNfdumpQuery(nfdumpFilter, newLimit);
                      }}
                      className="w-full bg-slate-900 border border-slate-800 text-slate-300 px-2 py-1.5 rounded outline-none transition"
                    >
                      <option value={10}>Exibir 10 fluxos</option>
                      <option value={25}>Exibir 25 fluxos</option>
                      <option value={50}>Exibir 50 fluxos</option>
                      <option value={100}>Exibir 100 fluxos</option>
                    </select>
                  </div>
                </div>

                {/* RAW SHELL QUERY INPUT & OUTPUT CONSOLE (RIGHT - 3 COLS) */}
                <div className="lg:col-span-3 flex flex-col space-y-4">
                  
                  {/* SEARCH ACTION BAR */}
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex items-center gap-3">
                    <span className="font-mono text-slate-500 select-none text-sm font-bold pl-2">nf-coletor:$</span>
                    
                    <div className="relative flex-1 select-all">
                      <input
                        type="text"
                        placeholder="Ex: proto TCP and port 443"
                        value={nfdumpFilter}
                        onChange={(e) => setNfdumpFilter(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") runNfdumpQuery(nfdumpFilter, limitCount);
                        }}
                        className="w-full bg-transparent border-none outline-none font-mono text-emerald-400 text-sm placeholder-slate-700"
                        title="Digite os filtros do nfdump"
                      />
                    </div>

                    <button
                      onClick={() => runNfdumpQuery(nfdumpFilter, limitCount)}
                      disabled={nfdumpLoading}
                      className="bg-emerald-600 hover:bg-emerald-500 font-bold text-white px-5 py-1.5 rounded transition flex items-center gap-1.5 cursor-pointer"
                    >
                      {nfdumpLoading ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Filtrando...
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-current" />
                          Executar sintaxe
                        </>
                      )}
                    </button>
                  </div>

                  {/* ASCII TERMINAL MONOSPACED CONSOLE */}
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex-1 font-mono text-xs overflow-x-auto min-h-[440px] flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2 mb-3 text-[10px] text-slate-500">
                        <span>ESTATÍSTICA DO TERMINAL NFDUMP DAEMON - FLUID BUFFER</span>
                        <span>[SAÍDA EM FORMATO PADRÃO ASCII TABULAR]</span>
                      </div>
                      
                      {nfdumpLoading ? (
                        <div className="flex flex-col items-center justify-center py-24 text-slate-500 space-y-2">
                          <RefreshCw className="w-8 h-8 animate-spin text-emerald-500" />
                          <span>Lendo dados e filtrando o dump binário...</span>
                        </div>
                      ) : (
                        <pre className="text-slate-300 break-words whitespace-pre leading-relaxed block font-mono text-[10.5px]">
                          {nfdumpOutput}
                        </pre>
                      )}
                    </div>

                    <div className="border-t border-slate-850/80 pt-3 mt-4 text-[10px] text-slate-500 flex justify-between">
                      <span>Coleta redundante: fprobe / softflowd 9995</span>
                      <span>Dica: Use filtros compostos como 'port 80 and bytes &gt; 5000'</span>
                    </div>
                  </div>

                </div>

              </div>
            </div>

          </div>
        )}

        {/* TAB 4: DEPLOYABLE PHP CONFIG SCRIPTS */}
        {activeTab === "php" && (
          <div className="space-y-6">
            
            {/* EDUCATIONAL STACK INFO CARD */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm text-xs">
              <h3 className="font-semibold text-white mb-2 flex items-center gap-2 text-md">
                <FileCode className="w-5 h-5 text-md text-emerald-400" />
                Arquitetura de Exportação e Integração (Linux / PHP / nfdump / rrdtool)
              </h3>
              <p className="text-xs text-slate-400 mb-6 font-normal">
                Esta tela disponibiliza os scripts PHP de produção e as estruturas de comando oficiais do <strong className="text-emerald-400">rrdtool</strong>. Use esses códigos diretamente na sua stack de servidores físicos ou virtuais (CentOS/Ubuntu) para colocar um ambiente real de NetFlow em pé!
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-950 p-4 border border-slate-800 rounded-xl space-y-2">
                  <span className="text-xs font-bold text-sky-400 uppercase tracking-widest block">1. Criar o Banco RRDtool (CLI)</span>
                  <p className="text-slate-400 text-xs">Cria o arquivo de banco RRD com estrutura Round Robin que consolida dados acumulados:</p>
                  <pre className="bg-slate-900 p-3 rounded font-mono text-[10px] text-slate-300 overflow-x-auto select-all border border-slate-800">
                    {rrdCreateCmd}
                  </pre>
                </div>

                <div className="bg-slate-950 p-4 border border-slate-800 rounded-xl space-y-2">
                  <span className="text-xs font-bold text-purple-400 uppercase tracking-widest block">2. Geração de Gráficos RRD (CLI)</span>
                  <p className="text-slate-400 text-xs">Comando utilizado pelo cron ou PHP para extrair a imagem PNG consolidando médias acumuladas:</p>
                  <pre className="bg-slate-900 p-3 rounded font-mono text-[10px] text-slate-300 overflow-x-auto select-all border border-slate-800">
                    {rrdGraphCmd}
                  </pre>
                </div>
              </div>
            </div>

            {/* TABBED PHP SCRIPTS CODE VIEWS */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
              <h4 className="font-semibold text-white mb-4 text-sm flex items-center gap-2">
                <Cpu className="w-5 h-5 text-emerald-400" />
                Templates de Produção de Código PHP
              </h4>
              
              <div className="space-y-6">
                {phpFiles.map((file, idx) => (
                  <div key={file.name} className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
                    <div className="bg-slate-900 px-4 py-3 border-b border-slate-800 flex justify-between items-center">
                      <div>
                        <span className="font-bold text-xs text-white block">{file.name}</span>
                        <span className="text-[10.5px] text-slate-400">{file.description}</span>
                      </div>
                      <button
                        onClick={() => copyToClipboard(file.code, idx)}
                        className="text-xs bg-slate-950 hover:bg-slate-800 text-slate-300 font-medium px-3 py-1.5 rounded-lg border border-slate-800 hover:border-slate-700 transition flex items-center gap-1 cursor-pointer"
                      >
                        {copiedIndex === idx ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            Copiado!
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            Copiar Código
                          </>
                        )}
                      </button>
                    </div>
                    <pre className="p-4 overflow-x-auto font-mono text-[10.5px] text-emerald-300/90 leading-relaxed bg-[#0a0f1d] selection:bg-slate-700 select-all max-h-[350px]">
                      {file.code}
                    </pre>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

      </main>

      {/* DETAILED GEMINI AI ASSISTANCE SHEET / DRAWER */}
      {analyzingAlert && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs z-50 flex justify-end transition-opacity duration-300">
          <div className="w-full max-w-2xl bg-slate-900 border-l border-slate-800 h-full shadow-2xl flex flex-col justify-between p-6 overflow-y-auto">
            
            {/* TITLE HEADER */}
            <div className="space-y-3">
              <div className="flex justify-between items-start">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                  analyzingAlert.severity === "critical" ? "bg-rose-950/60 text-rose-400 border border-rose-800/20" : "bg-amber-950/60 text-amber-400 border border-amber-800/20"
                }`}>
                  {analyzingAlert.severity} - {analyzingAlert.type}
                </span>
                <button
                  onClick={() => setAnalyzingAlert(null)}
                  className="text-slate-400 hover:text-slate-200 font-bold px-2 py-1 bg-slate-950 border border-slate-800 rounded-lg text-xs cursor-pointer"
                >
                  Fechar Painel
                </button>
              </div>

              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <ShieldAlert className="text-rose-500 w-5 h-5" />
                Copiloto AI Gemini: Resposta Automática a Incidentes de Rede
              </h3>
              <p className="text-xs text-slate-400">
                A IA analisou os fluxos de rede em tempo real no buffer de tráfego capturado e desenvolveu este manual de mitigação para conter a anomalia.
              </p>

              {/* THREAT CONTEXT SUB PANEL */}
              <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-xs space-y-1.5 mt-2">
                <div className="text-slate-400 font-bold uppercase text-[9px] tracking-wider mb-1">Amostra da Assinatura NetFlow</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>IP Origem: <span className="font-mono text-white font-semibold">{analyzingAlert.sourceIp}</span></div>
                  <div>IP Destino: <span className="font-mono text-white font-semibold">{analyzingAlert.destinationIp}</span></div>
                  {analyzingAlert.metrics.bytes && (
                    <div>Volume Bruto: <span className="font-mono text-emerald-400 font-semibold">{formatBytes(analyzingAlert.metrics.bytes)}</span></div>
                  )}
                  {analyzingAlert.metrics.packets && (
                    <div>Volume Pacotes: <span className="font-mono text-sky-400 font-semibold">{analyzingAlert.metrics.packets}</span></div>
                  )}
                </div>
                <div className="text-[11px] text-slate-300 font-medium italic mt-2 border-t border-slate-900 pt-2">
                  "{analyzingAlert.description}"
                </div>
              </div>
            </div>

            {/* LIVE AI INSIGHT MARKDOWN */}
            <div className="flex-1 my-6 overflow-y-auto">
              <div className="bg-slate-950 border border-emerald-500/20 rounded-xl p-5 min-h-[180px] flex flex-col justify-between">
                
                {aiLoading ? (
                  <div className="flex flex-col items-center justify-center py-16 space-y-3">
                    <Cpu className="w-8 h-8 text-emerald-400 animate-spin" />
                    <span className="text-slate-400 text-xs font-semibold">O Gemini está gerando as regras de firewall e analisando dumping...</span>
                    <span className="text-[10px] text-slate-500 font-mono italic">Consultando heurísticas e correlacionando logs binários...</span>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-1.5 border-b border-emerald-500/10 pb-3">
                      <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-ping"></div>
                      <span className="text-xs font-bold text-emerald-400 uppercase tracking-widest">
                        Análise de Engenharia SRE & Segurança
                      </span>
                    </div>
                    
                    <div className="text-slate-300 text-xs leading-relaxed whitespace-pre-wrap font-sans space-y-2">
                      {aiInsight}
                    </div>
                  </div>
                )}
                
              </div>
            </div>

            {/* ACTION FOOTER */}
            <div className="border-t border-slate-800 pt-4 flex gap-3 justify-end text-xs">
              <button
                onClick={() => analyzeWithGemini(analyzingAlert)}
                disabled={aiLoading}
                className="bg-slate-800 hover:bg-slate-700 active:bg-slate-800 border border-slate-700 text-slate-300 font-medium px-4 py-2 rounded-lg transition disabled:opacity-50 cursor-pointer"
              >
                Gerar Novo Diagnóstico
              </button>
              
              <button
                onClick={() => {
                  resolveAlert(analyzingAlert.id);
                  setAnalyzingAlert(null);
                }}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-5 py-2 rounded-lg transition cursor-pointer"
              >
                Mitigar e Fechar Alerta 🛡️
              </button>
            </div>

          </div>
        </div>
      )}

      {/* SIMPLE COMPACT FOOTER */}
      <footer className="border-t border-slate-900 bg-slate-950/80 py-4 px-6 text-center text-[11px] text-slate-500">
        <div>Desenvolvido com padrão nfdump + PHP script templates + RRDtool Database Emulation</div>
        <div className="mt-1 font-mono text-[9px]">AI Studio Network Operations Console &copy; 2026. Todos os direitos reservados.</div>
      </footer>

    </div>
  );
}
