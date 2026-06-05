// Service Worker — TRQR TAG Scanner PWA
const CACHE_NAME = 'trqr-scanner-v1';

// 오프라인에서도 동작할 파일 목록
const CACHE_FILES = [
  '/mobile',
  '/static/manifest.json',
  'https://unpkg.com/@zxing/library@0.19.1/umd/index.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
];

// ── 설치: 캐시 저장 ─────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] 캐시 설치 중...');
      // 각 파일 개별 캐시 (하나 실패해도 나머지 계속)
      return Promise.allSettled(
        CACHE_FILES.map(url =>
          cache.add(url).catch(e => console.warn('[SW] 캐시 실패:', url, e))
        )
      );
    }).then(() => {
      console.log('[SW] 설치 완료');
      return self.skipWaiting();
    })
  );
});

// ── 활성화: 구버전 캐시 삭제 ─────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] 구버전 캐시 삭제:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// ── fetch: 오프라인 전략 ──────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API 요청 — 네트워크 우선, 실패 시 오프라인 응답
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'offline', message: '오프라인 상태입니다. 데이터는 로컬에 저장됩니다.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // 앱 파일 — 캐시 우선, 없으면 네트워크
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // 백그라운드에서 최신 버전 갱신 (stale-while-revalidate)
        const fetchPromise = fetch(event.request).then(response => {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, response.clone());
            });
          }
          return response;
        }).catch(() => {});
        return cached;
      }
      // 캐시에 없으면 네트워크
      return fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // 완전 오프라인이면 오프라인 페이지
        return caches.match('/mobile');
      });
    })
  );
});

// ── 백그라운드 동기화 (인터넷 복구 시 자동 업로드) ─────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-scans') {
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'sync-request' });
        });
      })
    );
  }
});
