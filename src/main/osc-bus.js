'use strict';

const { EventEmitter } = require('events');
const { Server } = require('node-osc');

/**
 * 단일 UDP 소켓 OSC 버스.
 *
 * X32 는 요청을 보낸 "출발 포트"로 응답을 돌려준다. 따라서 보내기/받기를
 * 같은 소켓으로 처리해야 한다. node-osc 의 Server 는 바인딩된 자신의 소켓으로
 * send() 할 수 있으므로, Server 하나로 양방향 통신을 구현한다.
 *
 * 이벤트:
 *  - 'ready'              : 소켓 리스닝 시작
 *  - 'message' (addr, args, rinfo) : OSC 메시지 수신
 *  - 'error'  (err)
 */
class OscBus extends EventEmitter {
  constructor() {
    super();
    this._server = null;
    this._remoteHost = null;
    this._remotePort = null;
    this._pending = new Map(); // address -> [{ resolve, timer }]
    this._ready = false;
  }

  get isOpen() {
    return this._ready;
  }

  /**
   * 로컬 소켓을 열고 원격(X32) 주소를 설정한다.
   * @param {string} remoteHost X32 IP
   * @param {number} remotePort X32 OSC 포트 (기본 10023)
   * @param {number} localPort  로컬 바인딩 포트 (0 = 임의 포트, 기본)
   */
  open(remoteHost, remotePort = 10023, localPort = 0) {
    return new Promise((resolve, reject) => {
      if (this._server) {
        this.close();
      }
      this._remoteHost = remoteHost;
      this._remotePort = remotePort;

      const server = new Server(localPort, '0.0.0.0');
      this._server = server;

      const onError = (err) => {
        if (!this._ready) reject(err);
        this.emit('error', err);
      };
      server.on('error', onError);

      server.on('message', (msg, rinfo) => {
        // msg = [address, value1, value2, ...]
        const address = msg[0];
        const args = msg.slice(1);
        this._resolvePending(address, args);
        this.emit('message', address, args, rinfo);
      });

      server.on('listening', () => {
        this._ready = true;
        this.emit('ready', server.port);
        resolve(server.port);
      });
    });
  }

  /** OSC 메시지 전송. args 는 값 배열 또는 {type,value} 객체 배열. */
  send(address, args = []) {
    if (!this._server || !this._ready) {
      throw new Error('OSC 버스가 열려있지 않습니다.');
    }
    this._server.send([address, ...args], this._remotePort, this._remoteHost, (err) => {
      if (err) this.emit('error', err);
    });
  }

  /**
   * 주소를 질의(인자 없이 전송)하고 해당 주소의 응답을 기다린다.
   * @returns {Promise<Array>} 응답 인자 배열
   */
  query(address, timeoutMs = 1500) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._removePending(address, entry);
        reject(new Error(`질의 시간 초과: ${address}`));
      }, timeoutMs);

      const entry = { resolve, timer };
      if (!this._pending.has(address)) this._pending.set(address, []);
      this._pending.get(address).push(entry);

      try {
        this.send(address);
      } catch (err) {
        this._removePending(address, entry);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  _resolvePending(address, args) {
    const list = this._pending.get(address);
    if (!list || list.length === 0) return;
    const entry = list.shift();
    if (list.length === 0) this._pending.delete(address);
    clearTimeout(entry.timer);
    entry.resolve(args);
  }

  _removePending(address, entry) {
    const list = this._pending.get(address);
    if (!list) return;
    const idx = list.indexOf(entry);
    if (idx >= 0) list.splice(idx, 1);
    if (list.length === 0) this._pending.delete(address);
  }

  close() {
    // 대기 중인 질의 정리
    for (const list of this._pending.values()) {
      for (const entry of list) clearTimeout(entry.timer);
    }
    this._pending.clear();
    this._ready = false;
    if (this._server) {
      try {
        this._server.close();
      } catch (_) {
        /* ignore */
      }
      this._server = null;
    }
  }
}

module.exports = { OscBus };
