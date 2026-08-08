/**
 * SERVICE WORKER — Armazém Risso
 * --------------------------------
 * Estratégia:
 * - HTML principal (index.html): "network-first" -> sempre tenta buscar a
 *   versão mais nova; se estiver offline, usa a última salva em cache.
 * - Ícones, manifest e o próprio service worker: "cache-first" -> raramente
 *   mudam, então serve direto do cache pra abrir instantâneo.
 * - QUALQUER chamada para o Google Apps Script (script.google.com) passa
 *   direto pela rede e NUNCA é armazenada em cache — os dados do armazém
 *   precisam estar sempre atualizados.
 *
 * Para publicar uma atualização: basta subir os arquivos novos no GitHub.
 * Quando o navegador detectar que este arquivo mudou, ele instala a nova
 * versão em segundo plano e avisa o app (que mostra "Nova versão disponível").
 */

// Suba este número toda vez que quiser forçar a atualização do cache.
const VERSAO_CACHE = 'armazem-risso-v15';

const ARQUIVOS_ESTATICOS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png'
];

// Domínios que NUNCA devem ser armazenados em cache (dados dinâmicos)
const DOMINIOS_SEM_CACHE = [
  'script.google.com',
  'script.googleusercontent.com',
  'drive.google.com'
];

function ehChamadaDinamica(url) {
  return DOMINIOS_SEM_CACHE.some(dominio => url.includes(dominio));
}

// ===== INSTALL: baixa e guarda os arquivos estáticos =====
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSAO_CACHE)
      .then(cache => cache.addAll(ARQUIVOS_ESTATICOS))
      .catch(err => console.warn('[SW] Falha ao pré-cachear:', err))
  );
  // Não força skipWaiting automático — deixa o app pedir quando o usuário aceitar atualizar
});

// ===== ACTIVATE: limpa caches de versões antigas =====
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(nomes =>
      Promise.all(
        nomes
          .filter(nome => nome.startsWith('armazem-risso-') && nome !== VERSAO_CACHE)
          .map(nome => caches.delete(nome))
      )
    ).then(() => self.clients.claim())
  );
});

// ===== FETCH: decide a estratégia por tipo de requisição =====
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Nunca interceptar/cachear chamadas ao Apps Script ou Drive — sempre rede direta
  if (ehChamadaDinamica(url)) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Apenas GET é cacheável; outros métodos (POST etc.) vão direto pra rede
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  const ehHTML = event.request.mode === 'navigate' ||
                 (event.request.headers.get('accept') || '').includes('text/html');

  if (ehHTML) {
    // Network-first: tenta pegar a versão mais nova; se falhar, usa cache
    event.respondWith(
      fetch(event.request)
        .then(resposta => {
          const copia = resposta.clone();
          caches.open(VERSAO_CACHE).then(cache => cache.put(event.request, copia));
          return resposta;
        })
        .catch(() => caches.match(event.request).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Demais arquivos estáticos (ícones, manifest): cache-first com atualização em segundo plano
  event.respondWith(
    caches.match(event.request).then(respostaCache => {
      const buscaRede = fetch(event.request).then(resposta => {
        if (resposta && resposta.status === 200) {
          const copia = resposta.clone();
          caches.open(VERSAO_CACHE).then(cache => cache.put(event.request, copia));
        }
        return resposta;
      }).catch(() => respostaCache);
      return respostaCache || buscaRede;
    })
  );
});

// ===== MENSAGENS: permite que o app force a ativação da nova versão =====
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
