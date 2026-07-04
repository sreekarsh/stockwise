export default {
  apps: [{
    name: "stockwise",
    script: "server.js",
    instances: process.env.NODE_ENV === "production" ? 2 : 1,
    exec_mode: "cluster",
    env: {
      NODE_ENV: "development",
    },
    env_production: {
      NODE_ENV: "production",
    },
    error_file: "logs/err.log",
    out_file: "logs/out.log",
    max_restarts: 10,
    restart_delay: 4000,
    watch: process.env.NODE_ENV !== "production",
    watch_delay: 1000,
    ignore_watch: ["node_modules", "logs", "dist", "stockwise.db"],
  }],
};
