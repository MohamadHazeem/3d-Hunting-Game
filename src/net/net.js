import Peer from 'peerjs';

// Peer-to-peer multiplayer over WebRTC (PeerJS public signalling server).
// The host's browser is the authority for the birds; everyone connects to
// the host in a star. No game server needed — share the 5-letter code.

const PREFIX = 'lbhunt3d-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export class Net {
  constructor() {
    this.peer = null;
    this.isHost = false;
    this.conns = new Map(); // peerId -> conn
    this.handlers = {};
    this.code = null;
    this.myId = null;
    this.hostConn = null;
  }

  on(type, fn) {
    this.handlers[type] = fn;
  }

  dispatch(msg, from) {
    const h = this.handlers[msg.t];
    if (h) h(msg, from);
  }

  host() {
    return new Promise((resolve, reject) => {
      const tryOpen = (attempt) => {
        const code = makeCode();
        const peer = new Peer(PREFIX + code, { debug: 1 });
        peer.on('open', (id) => {
          this.peer = peer;
          this.isHost = true;
          this.code = code;
          this.myId = id;
          resolve(code);
        });
        peer.on('error', (err) => {
          if (err.type === 'unavailable-id' && attempt < 4) {
            peer.destroy();
            tryOpen(attempt + 1);
          } else if (!this.peer) reject(err);
          else console.warn('peer error', err);
        });
        peer.on('connection', (conn) => {
          conn.on('open', () => {
            this.conns.set(conn.peer, conn);
          });
          conn.on('data', (d) => this.dispatch(d, conn.peer));
          conn.on('close', () => {
            this.conns.delete(conn.peer);
            this.dispatch({ t: 'leave' }, conn.peer);
          });
          conn.on('error', () => {});
        });
        peer.on('disconnected', () => {
          try {
            peer.reconnect();
          } catch {}
        });
      };
      tryOpen(0);
    });
  }

  join(code) {
    code = code.trim().toUpperCase();
    return new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 1 });
      const timer = setTimeout(() => reject(new Error('Could not reach that hunt (timeout).')), 15000);
      peer.on('open', (id) => {
        this.peer = peer;
        this.myId = id;
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('open', () => {
          clearTimeout(timer);
          this.hostConn = conn;
          this.code = code;
          resolve();
        });
        conn.on('data', (d) => this.dispatch(d, 'host'));
        conn.on('close', () => this.dispatch({ t: 'hostLost' }, 'host'));
        conn.on('error', (e) => reject(e));
      });
      peer.on('error', (err) => {
        clearTimeout(timer);
        if (err.type === 'peer-unavailable') reject(new Error('No hunt with that code.'));
        else reject(err);
      });
    });
  }

  // client -> host, or host -> one client
  send(msg, to = null) {
    if (this.isHost) {
      const c = this.conns.get(to);
      if (c && c.open) c.send(msg);
    } else if (this.hostConn && this.hostConn.open) {
      this.hostConn.send(msg);
    }
  }

  broadcast(msg, except = null) {
    if (!this.isHost) return this.send(msg);
    for (const [id, c] of this.conns) if (id !== except && c.open) c.send(msg);
  }

  get playerCount() {
    return this.isHost ? this.conns.size + 1 : 0;
  }

  close() {
    if (this.peer) this.peer.destroy();
    this.peer = null;
    this.conns.clear();
  }
}
