interface RequestLog {
  ts: number;
  method: string;
  path: string;
  status: number;
  duration: number;
}

interface ErrorLog {
  ts: number;
  message: string;
  stack?: string;
  path?: string;
  statusCode?: number;
}

interface SystemEvent {
  ts: number;
  type: string;
  message: string;
}

class LogBuffer {
  private requests: RequestLog[] = [];
  private errors: ErrorLog[] = [];
  private events: SystemEvent[] = [];
  private readonly maxRequests = 2000;
  private readonly maxErrors = 500;
  private readonly maxEvents = 200;

  trackRequest(method: string, path: string, status: number, duration: number) {
    this.requests.push({ ts: Date.now(), method, path, status, duration });
    if (this.requests.length > this.maxRequests) this.requests.shift();
  }

  trackError(message: string, stack?: string, path?: string, statusCode?: number) {
    this.errors.push({ ts: Date.now(), message, stack, path, statusCode });
    if (this.errors.length > this.maxErrors) this.errors.shift();
  }

  trackEvent(type: string, message: string) {
    this.events.push({ ts: Date.now(), type, message });
    if (this.events.length > this.maxEvents) this.events.shift();
  }

  getAnalysis() {
    const now = Date.now();
    const oneHour = 3600000;
    const lastHour = this.requests.filter(r => r.ts > now - oneHour);
    const statusBreakdown: Record<string, number> = {};
    const pathCounts: Record<string, { count: number; totalDuration: number }> = {};
    let totalDuration = 0;
    let errorCount = 0;

    for (const r of this.requests) {
      const cat = `${Math.floor(r.status / 100)}xx`;
      statusBreakdown[cat] = (statusBreakdown[cat] || 0) + 1;
      totalDuration += r.duration;
      if (r.status >= 400) errorCount++;

      const key = r.path;
      if (!pathCounts[key]) pathCounts[key] = { count: 0, totalDuration: 0 };
      pathCounts[key].count++;
      pathCounts[key].totalDuration += r.duration;
    }

    const topPaths = Object.entries(pathCounts)
      .map(([path, v]) => ({ path, count: v.count, avgDuration: Math.round(v.totalDuration / v.count) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    const durations = this.requests.map(r => r.duration).sort((a, b) => a - b);
    const p95 = durations.length ? durations[Math.floor(durations.length * 0.95)] : 0;
    const slowest = this.requests.reduce((a, b) => a.duration > b.duration ? a : b, this.requests[0]);

    const hours: Record<string, { count: number; errors: number }> = {};
    for (let i = 24; i >= 0; i--) {
      const h = new Date(now - i * oneHour).toISOString().slice(0, 13) + ":00";
      hours[h] = { count: 0, errors: 0 };
    }
    for (const r of this.requests) {
      const h = new Date(r.ts).toISOString().slice(0, 13) + ":00";
      if (hours[h]) { hours[h].count++; if (r.status >= 400) hours[h].errors++; }
    }

    return {
      summary: {
        totalRequests: this.requests.length,
        totalErrors: this.errors.length,
        recentErrorCount: errorCount,
        errorRate: this.requests.length ? Math.round((errorCount / this.requests.length) * 100) : 0,
        avgDuration: this.requests.length ? Math.round(totalDuration / this.requests.length) : 0,
        p95Duration: p95,
        slowestPath: slowest ? { path: slowest.path, duration: slowest.duration, status: slowest.status, method: slowest.method } : null,
        requestsLastHour: lastHour.length,
        statusBreakdown,
        topPaths,
        requestsByHour: Object.entries(hours).map(([hour, v]) => ({ hour, ...v })),
      },
      recentRequests: this.requests.slice(-50).reverse(),
      recentErrors: [...this.errors].reverse(),
      events: [...this.events].reverse(),
    };
  }
}

export const logBuffer = new LogBuffer();
export default logBuffer;
