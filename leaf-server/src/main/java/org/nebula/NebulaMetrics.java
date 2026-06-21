package org.nebula;

import com.google.common.util.concurrent.ThreadFactoryBuilder;
import com.mojang.logging.LogUtils;
import com.sun.net.httpserver.HttpServer;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import org.slf4j.Logger;

public class NebulaMetrics {

    private static final Logger LOGGER = LogUtils.getLogger();
    private static final int DEFAULT_PORT = Integer.parseInt(System.getProperty("nebula.metrics.port", "25510"));
    private static final String DEFAULT_BIND = System.getProperty("nebula.metrics.bind", "0.0.0.0");

    private final MinecraftServer server;
    private HttpServer httpServer;

    public NebulaMetrics(final MinecraftServer server) {
        this.server = server;
    }

    public void start() {
        try {
            this.httpServer = HttpServer.create(new InetSocketAddress(DEFAULT_BIND, DEFAULT_PORT), 0);
            this.httpServer.setExecutor(Executors.newFixedThreadPool(2,
                new ThreadFactoryBuilder().setNameFormat("Nebula Metrics - %d").setDaemon(true).build()
            ));

            this.httpServer.createContext("/health", exchange -> {
                byte[] resp = "OK".getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "text/plain");
                exchange.sendResponseHeaders(200, resp.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(resp);
                }
            });

            this.httpServer.createContext("/live", exchange -> {
                byte[] resp = this.buildLiveJson().getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, resp.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(resp);
                }
            });

            this.httpServer.createContext("/metrics", exchange -> {
                byte[] resp = this.buildPrometheusMetrics().getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "text/plain; version=0.0.4");
                exchange.sendResponseHeaders(200, resp.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(resp);
                }
            });

            this.httpServer.start();
            LOGGER.info("Nebula metrics endpoint listening on {}:{}", DEFAULT_BIND, this.httpServer.getAddress().getPort());
        } catch (Exception e) {
            LOGGER.error("Failed to start Nebula metrics endpoint", e);
        }
    }

    public void stop() {
        if (this.httpServer != null) {
            this.httpServer.stop(1);
            LOGGER.info("Nebula metrics endpoint stopped");
        }
    }

    private String buildLiveJson() {
        double[] tps = this.server.getTPSIncluding5SecondsReadOnly();
        Runtime rt = Runtime.getRuntime();
        long usedMem = (rt.totalMemory() - rt.freeMemory()) / (1024L * 1024L);
        long totalMem = rt.totalMemory() / (1024L * 1024L);

        StringBuilder sb = new StringBuilder();
        sb.append("{\n");
        sb.append("  \"tps\": {\"5s\": ").append(formatTps(tps[0]))
            .append(", \"1m\": ").append(formatTps(tps[1]))
            .append(", \"5m\": ").append(formatTps(tps[2]))
            .append(", \"15m\": ").append(formatTps(tps[3])).append("},\n");
        sb.append("  \"mspt\": ").append(String.format(java.util.Locale.ROOT, "%.1f", this.server.getCurrentSmoothedTickTime())).append(",\n");
        sb.append("  \"players\": ").append(this.server.getPlayerCount()).append(",\n");
        sb.append("  \"maxPlayers\": ").append(this.server.getMaxPlayers()).append(",\n");
        sb.append("  \"tickCount\": ").append(this.server.getTickCount()).append(",\n");
        sb.append("  \"uptimeMs\": ").append((System.nanoTime() - MinecraftServer.SERVER_INIT) / 1_000_000L).append(",\n");
        sb.append("  \"memory\": {\"usedMb\": ").append(usedMem).append(", \"totalMb\": ").append(totalMem).append("},\n");
        sb.append("  \"worlds\": [\n");
        boolean first = true;
        for (ServerLevel level : this.server.getAllLevels()) {
            if (!first) sb.append(",\n");
            first = false;
            sb.append("    {\"name\": \"").append(level.dimension().identifier())
                .append("\", \"players\": ").append(level.players().size())
                .append(", \"entities\": ").append(level.moonrise$getEntityLookup().getEntityCount()).append("}");
        }
        sb.append("\n  ]\n");
        sb.append("}\n");
        return sb.toString();
    }

    private String buildPrometheusMetrics() {
        double[] tps = this.server.getTPSIncluding5SecondsReadOnly();
        float mspt = this.server.getCurrentSmoothedTickTime();
        Runtime rt = Runtime.getRuntime();

        StringBuilder sb = new StringBuilder();
        sb.append("# HELP nebula_tps Server TPS by window\n");
        sb.append("# TYPE nebula_tps gauge\n");
        sb.append("nebula_tps{window=\"5s\"} ").append(formatTps(tps[0])).append("\n");
        sb.append("nebula_tps{window=\"1m\"} ").append(formatTps(tps[1])).append("\n");
        sb.append("nebula_tps{window=\"5m\"} ").append(formatTps(tps[2])).append("\n");
        sb.append("nebula_tps{window=\"15m\"} ").append(formatTps(tps[3])).append("\n");

        sb.append("# HELP nebula_mspt Current smoothed MSPT\n");
        sb.append("# TYPE nebula_mspt gauge\n");
        sb.append("nebula_mspt ").append(String.format(java.util.Locale.ROOT, "%.1f", mspt)).append("\n");

        sb.append("# HELP nebula_players Current online players\n");
        sb.append("# TYPE nebula_players gauge\n");
        sb.append("nebula_players ").append(this.server.getPlayerCount()).append("\n");

        sb.append("# HELP nebula_tick_count Server tick count\n");
        sb.append("# TYPE nebula_tick_count counter\n");
        sb.append("nebula_tick_count ").append(this.server.getTickCount()).append("\n");

        sb.append("# HELP nebula_memory JVM memory in MB\n");
        sb.append("# TYPE nebula_memory gauge\n");
        sb.append("nebula_memory{area=\"used\"} ").append((rt.totalMemory() - rt.freeMemory()) / (1024L * 1024L)).append("\n");
        sb.append("nebula_memory{area=\"total\"} ").append(rt.totalMemory() / (1024L * 1024L)).append("\n");
        sb.append("nebula_memory{area=\"max\"} ").append(rt.maxMemory() / (1024L * 1024L)).append("\n");

        sb.append("# HELP nebula_entities Entity count per world\n");
        sb.append("# TYPE nebula_entities gauge\n");
        for (ServerLevel level : this.server.getAllLevels()) {
            sb.append("nebula_entities{world=\"").append(level.dimension().identifier()).append("\"} ")
                .append(level.moonrise$getEntityLookup().getEntityCount()).append("\n");
        }

        return sb.toString();
    }

    private static String formatTps(double tps) {
        return tps > 20.0D ? String.format(java.util.Locale.ROOT, "%.2f", 20.0D) : String.format(java.util.Locale.ROOT, "%.2f", tps);
    }
}
