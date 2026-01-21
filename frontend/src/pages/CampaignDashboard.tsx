import { useState, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    ArrowLeft,
    Send,
    CheckCheck,
    Eye,
    MessageSquare,
    Clock,
    RefreshCw,
    TrendingUp
} from "lucide-react";
import { campaignsService } from "@/services/api";

interface CampaignStats {
    campaignName: string;
    totalContacts: number;
    sent: number;
    pending: number;
    failed: number;
    delivered: number;
    read: number;
    responses: number;
    successRate: string;
    deliveryRate: string;
    readRate: string;
    responseRate: string;
}

export default function CampaignDashboard() {
    const [searchParams] = useSearchParams();
    const campaignNameFromUrl = searchParams.get("name") || "";

    const [campaignName, setCampaignName] = useState(campaignNameFromUrl);
    const [searchInput, setSearchInput] = useState(campaignNameFromUrl);
    const [stats, setStats] = useState<CampaignStats | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [autoRefresh, setAutoRefresh] = useState(false);

    const [nextMessages, setNextMessages] = useState<Array<{ contactName: string; contactPhone: string; message: string; timestamp: number; scheduledAt: string }>>([]);

    const fetchStats = async (name: string) => {
        if (!name.trim()) return;

        setLoading(true);
        setError("");
        try {
            const data = await campaignsService.getStats(name);
            setStats(data as CampaignStats);

            const next = await campaignsService.getNextMessages(name);
            setNextMessages(next);
        } catch (err: any) {
            setError(err.message || "Erro ao buscar estatísticas");
            setStats(null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (campaignName) {
            fetchStats(campaignName);
        }
    }, [campaignName]);

    // Auto-refresh a cada 10 segundos
    useEffect(() => {
        if (!autoRefresh || !campaignName) return;

        const interval = setInterval(() => {
            fetchStats(campaignName);
        }, 10000);

        return () => clearInterval(interval);
    }, [autoRefresh, campaignName]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setCampaignName(searchInput);
    };

    const progressPercent = stats
        ? ((stats.sent / stats.totalContacts) * 100)
        : 0;

    return (
        <div className="min-h-screen bg-background p-6">
            <div className="max-w-6xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link to="/campanhas">
                            <Button variant="ghost" size="icon">
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold">Dashboard de Campanhas</h1>
                            <p className="text-muted-foreground">Acompanhe o progresso em tempo real</p>
                        </div>
                    </div>

                    <Button
                        variant={autoRefresh ? "default" : "outline"}
                        onClick={() => setAutoRefresh(!autoRefresh)}
                        className="gap-2"
                    >
                        <RefreshCw className={`h-4 w-4 ${autoRefresh ? "animate-spin" : ""}`} />
                        {autoRefresh ? "Auto-refresh ON" : "Auto-refresh OFF"}
                    </Button>
                </div>

                {/* Search */}
                <GlassCard padding="md">
                    <form onSubmit={handleSearch} className="flex gap-4">
                        <Input
                            placeholder="Nome da campanha..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            className="flex-1"
                        />
                        <Button type="submit" disabled={loading}>
                            {loading ? "Buscando..." : "Buscar"}
                        </Button>
                    </form>
                </GlassCard>

                {error && (
                    <GlassCard padding="md" className="bg-destructive/10 border-destructive/30">
                        <p className="text-destructive">{error}</p>
                    </GlassCard>
                )}

                {stats && (
                    <>
                        {/* Campaign Name */}
                        <div className="text-center">
                            <h2 className="text-3xl font-bold text-primary">{stats.campaignName}</h2>
                            <p className="text-muted-foreground mt-2">
                                {stats.totalContacts.toLocaleString()} contatos totais
                            </p>
                        </div>

                        {/* Progress Bar */}
                        <GlassCard padding="lg">
                            <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                    <span className="font-medium">Progresso do Envio</span>
                                    <span className="text-2xl font-bold text-primary">
                                        {progressPercent.toFixed(1)}%
                                    </span>
                                </div>
                                <div className="h-4 bg-muted rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-500"
                                        style={{ width: `${progressPercent}%` }}
                                    />
                                </div>
                                <div className="flex justify-between text-sm text-muted-foreground">
                                    <span>{stats.sent.toLocaleString()} enviados</span>
                                    <span>{stats.pending.toLocaleString()} pendentes</span>
                                </div>
                            </div>
                        </GlassCard>

                        {/* Metrics Cards */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {/* Enviados */}
                            <GlassCard padding="md" className="text-center">
                                <Send className="h-8 w-8 mx-auto text-primary mb-2" />
                                <div className="text-3xl font-bold">{stats.sent.toLocaleString()}</div>
                                <div className="text-sm text-muted-foreground">Enviados</div>
                                <div className="text-xs text-primary mt-1">{stats.successRate}%</div>
                            </GlassCard>

                            {/* Entregues */}
                            <GlassCard padding="md" className="text-center">
                                <CheckCheck className="h-8 w-8 mx-auto text-green-500 mb-2" />
                                <div className="text-3xl font-bold">{stats.delivered.toLocaleString()}</div>
                                <div className="text-sm text-muted-foreground">Entregues</div>
                                <div className="text-xs text-green-500 mt-1">{stats.deliveryRate}%</div>
                            </GlassCard>

                            {/* Lidos */}
                            <GlassCard padding="md" className="text-center">
                                <Eye className="h-8 w-8 mx-auto text-blue-500 mb-2" />
                                <div className="text-3xl font-bold">{stats.read.toLocaleString()}</div>
                                <div className="text-sm text-muted-foreground">Lidos</div>
                                <div className="text-xs text-blue-500 mt-1">{stats.readRate}%</div>
                            </GlassCard>

                            {/* Respostas */}
                            <GlassCard padding="md" className="text-center">
                                <MessageSquare className="h-8 w-8 mx-auto text-yellow-500 mb-2" />
                                <div className="text-3xl font-bold">{stats.responses.toLocaleString()}</div>
                                <div className="text-sm text-muted-foreground">Respostas</div>
                                <div className="text-xs text-yellow-500 mt-1">{stats.responseRate}%</div>
                            </GlassCard>
                        </div>

                        {/* Secondary Metrics */}
                        <div className="grid grid-cols-2 gap-4">
                            {/* Pendentes */}
                            <GlassCard padding="md">
                                <div className="flex items-center gap-4">
                                    <Clock className="h-10 w-10 text-yellow-500" />
                                    <div>
                                        <div className="text-2xl font-bold">{stats.pending.toLocaleString()}</div>
                                        <div className="text-sm text-muted-foreground">Pendentes de envio</div>
                                    </div>
                                </div>
                            </GlassCard>

                            {/* Falhas */}
                            <GlassCard padding="md">
                                <div className="flex items-center gap-4">
                                    <TrendingUp className="h-10 w-10 text-red-500" />
                                    <div>
                                        <div className="text-2xl font-bold">{stats.failed.toLocaleString()}</div>
                                        <div className="text-sm text-muted-foreground">Falhas no envio</div>
                                    </div>
                                </div>
                            </GlassCard>
                        </div>

                        {/* Last Update */}
                        <p className="text-center text-xs text-muted-foreground">
                            Última atualização: {new Date().toLocaleTimeString()}
                            {autoRefresh && " • Atualizando a cada 10 segundos"}
                        </p>
                    </>
                )}

                {/* Next Messages */}
                {nextMessages.length > 0 && (
                    <div className="space-y-4">
                        <h3 className="text-xl font-semibold">Próximas Mensagens Agendadas</h3>
                        <GlassCard padding="none" className="overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs uppercase bg-muted/50 text-muted-foreground">
                                        <tr>
                                            <th className="px-4 py-3">Contato</th>
                                            <th className="px-4 py-3">Mensagem</th>
                                            <th className="px-4 py-3">Horário Previsto (SP)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {nextMessages.map((msg, idx) => (
                                            <tr key={idx} className="border-b border-muted last:border-0 hover:bg-muted/20">
                                                <td className="px-4 py-3 font-medium">
                                                    <div>{msg.contactName}</div>
                                                    <div className="text-xs text-muted-foreground">{msg.contactPhone}</div>
                                                </td>
                                                <td className="px-4 py-3 max-w-md truncate" title={msg.message}>
                                                    {msg.message}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap">
                                                    <div className="flex items-center gap-2">
                                                        <Clock className="h-3 w-3 text-muted-foreground" />
                                                        {new Date(msg.scheduledAt).toLocaleString('pt-BR', {
                                                            timeZone: 'America/Sao_Paulo',
                                                            hour: '2-digit',
                                                            minute: '2-digit',
                                                            second: '2-digit'
                                                        })}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </GlassCard>
                    </div>
                )}

                {!stats && !loading && !error && (
                    <GlassCard padding="lg" className="text-center">
                        <TrendingUp className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                        <h3 className="text-lg font-medium">Nenhuma campanha selecionada</h3>
                        <p className="text-muted-foreground mt-2">
                            Digite o nome de uma campanha para ver as estatísticas
                        </p>
                    </GlassCard>
                )}
            </div>
        </div>
    );
}
