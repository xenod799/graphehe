const { Worker } = require("worker_threads");
const path = require("path");

const WORKER_PATH = path.join(__dirname, "render-worker.js");

class RenderPool {
  constructor({ size = 2, timeoutMs = 15000, maxQueue = 4 } = {}) {
    this.size = size;
    this.timeoutMs = timeoutMs;
    this.maxQueue = maxQueue;
    this.idle = [];
    this.busy = 0;
    this.waiters = [];
    this._create = () => new Worker(WORKER_PATH);
  }

  _acquire() {
    if (this.idle.length) return Promise.resolve(this.idle.pop());
    if (this.idle.length + this.busy < this.size) {
      this.busy++;
      return Promise.resolve(this._create());
    }
    if (this.waiters.length >= this.maxQueue) {
      const err = new Error("Server busy");
      err.status = 503;
      return Promise.reject(err);
    }
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  _release(worker) {
    this.busy--;
    if (this.waiters.length) {
      const next = this.waiters.shift();
      this.busy++;
      next.resolve(worker);
    } else {
      this.idle.push(worker);
    }
  }

  _replace(worker) {
    this.busy--;
    worker.terminate().catch(() => {});
    if (this.waiters.length) {
      const next = this.waiters.shift();
      this.busy++;
      next.resolve(this._create());
    }
  }

  run(payload) {
    return new Promise((resolve, reject) => {
      this._acquire()
        .then((worker) => {
          let settled = false;
          let timer = null;
          const settle = (fn, val) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn(val);
          };
          const onMsg = (msg) => {
            if (!settled) this._release(worker);
            settle(resolve, msg);
          };
          const onErr = (err) => {
            if (!settled) this._replace(worker);
            settle(reject, err);
          };
          worker.on("message", onMsg);
          worker.on("error", onErr);
          worker.postMessage(payload);
          timer = setTimeout(() => {
            if (!settled) this._replace(worker);
            const err = new Error("Render timed out");
            err.status = 503;
            settle(reject, err);
          }, this.timeoutMs);
        })
        .catch(reject);
    });
  }
}

module.exports = { RenderPool };
