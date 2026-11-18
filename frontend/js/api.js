// All traffic to the Python backend lives here.
import {API_BASE, API_KEY} from './config.js';

export class GestureLink {
  constructor() { this.ws = null; this.last = null; this.busy = false; this.sentAt = 0; this.connect(); }
  connect() {
    const url = (API_BASE || location.origin).replace(/^http/, 'ws') + '/ws/gesture';
    try { this.ws = new WebSocket(url); } catch (e) { return this.retry(); }
    this.ws.onmessage = e => { this.busy = false; this.last = {...JSON.parse(e.data), t: performance.now()}; };
    this.ws.onclose = () => { this.last = null; this.retry(); };
  }
  retry() { setTimeout(() => this.connect(), 2000); }
  // same features the model was trained on: landmarks centred on the wrist, divided by wrist-to-middle-knuckle distance
  send(lm) {
    if (!this.ws || this.ws.readyState !== 1 || (this.busy && performance.now() - this.sentAt < 300)) return;
    const w = lm[0], d = lm[9], s = Math.hypot(d.x - w.x, d.y - w.y, d.z - w.z) || 1e-3, f = [];
    lm.forEach(p => f.push((p.x - w.x) / s, (p.y - w.y) / s, (p.z - w.z) / s));
    this.busy = true; this.sentAt = performance.now(); this.ws.send(JSON.stringify(f));
  }
  fresh(maxAge = 250) { return this.last && performance.now() - this.last.t < maxAge ? this.last : null; }
}

const ok = r => { if (!r.ok) throw new Error('API ' + r.status); return r.json(); };
const headers = () => ({'Content-Type': 'application/json', ...(API_KEY ? {'X-API-Key': API_KEY} : {})});
export const saveDesign = (name, blocks) => fetch(`${API_BASE}/api/designs`, {method: 'POST', headers: headers(), body: JSON.stringify({name, blocks})}).then(ok);
export const listDesigns = () => fetch(`${API_BASE}/api/designs`).then(ok);
export const loadDesign = id => fetch(`${API_BASE}/api/designs/${id}`).then(ok);
