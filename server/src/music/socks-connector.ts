// undici connector that opens every connection through a SOCKS proxy. The
// target hostname is handed to the proxy (SOCKS5 domain / SOCKS4a), so the
// proxy resolves it; https targets get TLS on top of the tunnelled socket.
import net from 'node:net';
import tls from 'node:tls';
import { SocksClient, type SocksProxy } from 'socks';
import type { buildConnector } from 'undici';

export const SOCKS_CONNECT_TIMEOUT_MS = 10_000;
const HTTPS_PROTOCOL = 'https:';
const DEFAULT_HTTPS_PORT = 443;
const DEFAULT_HTTP_PORT = 80;
const ALPN_HTTP1 = ['http/1.1'];

function targetPort(protocol: string, port: string): number {
  if (port !== '') return Number(port);
  return protocol === HTTPS_PROTOCOL ? DEFAULT_HTTPS_PORT : DEFAULT_HTTP_PORT;
}

/** URL and undici keep IPv6 literals in brackets; SOCKS wants the bare address. */
export function bareHost(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function startTls(
  socket: net.Socket,
  host: string,
  servername: string | undefined,
  callback: buildConnector.Callback,
): void {
  // SNI must be a hostname: never send an IP literal (RFC 6066 §3).
  const name = servername || (net.isIP(host) === 0 ? host : undefined);
  const secure = tls.connect({ socket, servername: name, ALPNProtocols: ALPN_HTTP1 });
  let settled = false;
  secure.once('secureConnect', () => {
    if (settled) return;
    settled = true;
    callback(null, secure);
  });
  secure.once('error', (error) => {
    if (settled) return;
    settled = true;
    secure.destroy();
    callback(error, null);
  });
}

/** Calls back exactly once: with the connected (and, for https, secured) socket or the error. */
export function socksConnector(proxy: SocksProxy, timeoutMs = SOCKS_CONNECT_TIMEOUT_MS): buildConnector.connector {
  return (options, callback) => {
    const host = bareHost(options.hostname);
    const destination = { host, port: targetPort(options.protocol, options.port) };
    SocksClient.createConnection({ command: 'connect', proxy, destination, timeout: timeoutMs })
      .then(({ socket }) => {
        socket.setNoDelay(true);
        if (options.protocol !== HTTPS_PROTOCOL) {
          callback(null, socket);
          return;
        }
        startTls(socket, host, options.servername, callback);
      })
      .catch((error: unknown) => {
        callback(error instanceof Error ? error : new Error('SOCKS connection failed'), null);
      });
  };
}
