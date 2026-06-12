document.addEventListener('DOMContentLoaded', () => {
  // Init Lucide Icons
  lucide.createIcons();

  // DOM Elements
  const productSearchInput = document.getElementById('product-search');
  const searchBtn = document.getElementById('search-btn');
  const searchResults = document.getElementById('search-results');
  const suggestDropdown = document.getElementById('suggest-dropdown');
  const sortToggle = document.getElementById('sort-toggle');
  const categoryChips = document.getElementById('category-chips');
  const recentChips = document.getElementById('recent-chips');
  const promoFilterChip = document.getElementById('promo-filter-chip');
  const resultsContext = document.getElementById('results-context');

  const cartList = document.getElementById('cart-list');
  const emptyCartMsg = document.getElementById('empty-cart-msg');
  const cartCount = document.getElementById('cart-count');
  const cartSummary = document.getElementById('cart-summary');
  const cartTotal = document.getElementById('cart-total');

  const locLabel = document.getElementById('loc-label');
  const mapDrawer = document.getElementById('map-drawer');
  const mapToggle = document.getElementById('map-toggle');
  const userLocationSelect = document.getElementById('user-location');
  const maxDistanceSlider = document.getElementById('max-distance');
  const distanceValSpan = document.getElementById('distance-val');
  const optimizeBtn = document.getElementById('optimize-btn');
  const routesContainer = document.getElementById('routes-container');
  const toastEl = document.getElementById('toast');

  // ----- persisted state -----
  const KEYS = {
    cart: 'shakufsal_cart',
    loc: 'shakufsal_loc',
    radius: 'shakufsal_radius',
    sort: 'shakufsal_sort',
    recent: 'shakufsal_recent',
    mapOpen: 'shakufsal_map',
  };

  const readJSON = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      const val = raw ? JSON.parse(raw) : fallback;
      return val ?? fallback;
    } catch (err) { return fallback; }
  };
  const writeJSON = (key, val) => {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (err) { /* storage blocked */ }
  };

  const cityPresets = {
    jerusalem: { lat: 31.7680, lon: 35.2100, name: 'ירושלים' },
    tel_aviv: { lat: 32.0800, lon: 34.7800, name: 'תל אביב' },
    haifa: { lat: 32.8000, lon: 35.0000, name: 'חיפה' },
    beer_sheva: { lat: 31.2530, lon: 34.7915, name: 'באר שבע' },
    rehovot: { lat: 31.9000, lon: 34.8100, name: 'רחובות' },
    netanya: { lat: 32.3215, lon: 34.8532, name: 'נתניה' },
    afula: { lat: 32.6078, lon: 35.2897, name: 'עפולה' },
  };

  let cart = readJSON(KEYS.cart, []);
  let currentLocation = readJSON(KEYS.loc, { lat: 31.7680, lon: 35.2100, label: 'ירושלים (מרכז)' });
  let recentSearches = readJSON(KEYS.recent, []);
  let currentSort = readJSON(KEYS.sort, 'cheapest');
  let mapOpen = readJSON(KEYS.mapOpen, true);
  maxDistanceSlider.value = readJSON(KEYS.radius, 10);

  let allStores = [];
  let chainMeta = {}; // chain_id -> { name, color }
  let lastResults = []; // raw rows of the latest search (pre promo-filter)
  let lastQuery = '';
  let promoOnly = false;

  // Leaflet Map State
  let map;
  let userMarker;
  let routeLines = [];
  let mapStoreMarkers = [];
  let nearbyStoreMarkers = [];

  function debounce(fn, ms) {
    let t;
    const wrapped = (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
    wrapped.cancel = () => clearTimeout(t);
    return wrapped;
  }

  let toastTimer;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
      setTimeout(() => { toastEl.hidden = true; }, 250);
    }, 1700);
  }

  // ----- bootstrap data -----

  async function loadChains() {
    try {
      const res = await fetch('/api/v1/chains');
      const data = await res.json();
      if (data.success) {
        data.data.forEach(c => {
          chainMeta[c.id] = { name: c.name_he, color: c.color || '#94a3b8' };
        });
      }
    } catch (err) {
      console.error('Failed to load chains:', err);
    }
  }

  async function loadStores() {
    try {
      const res = await fetch('/api/v1/stores');
      const data = await res.json();
      if (data.success) {
        allStores = data.data.filter(s => s.latitude != null && s.longitude != null);
        renderAllNearbyStoresOnMap();
      }
    } catch (err) {
      console.error('Failed to load stores:', err);
    }
  }

  function getChainNameHebrew(id) {
    return (chainMeta[id] && chainMeta[id].name) || id;
  }

  function getChainColor(id) {
    return (chainMeta[id] && chainMeta[id].color) || '#94a3b8';
  }

  // unit_price is normalized to per-100g / per-100ml for weight/volume items
  // (kg/liter included) and per-unit otherwise — label accordingly.
  const WEIGHT_UNITS = ['גרם', 'גר', 'גרמים', 'קג', 'קילו', 'קילוגרם', 'קילוגרמים'];
  const VOLUME_UNITS = ['מל', 'מיליליטר', 'מיליליטרים', 'ליטר', 'ליטרים', 'לטר'];
  function cleanUnit(unit) {
    return String(unit || '').replace(/[׳״'"`]/g, '').trim();
  }
  function unitPriceLabel(unit) {
    const u = cleanUnit(unit);
    if (WEIGHT_UNITS.includes(u)) return 'ל-100 גרם';
    if (VOLUME_UNITS.includes(u)) return 'ל-100 מ"ל';
    return 'ליחידה';
  }
  function isMeasurable(unit) {
    const u = cleanUnit(unit);
    return WEIGHT_UNITS.includes(u) || VOLUME_UNITS.includes(u);
  }

  // ----- location -----

  // Every location change funnels through here: marker, label, persistence,
  // store markers, and a re-search if a query is active.
  function setLocation(lat, lon, label, opts = {}) {
    currentLocation = { lat, lon, label };
    writeJSON(KEYS.loc, currentLocation);
    locLabel.textContent = label;
    if (userMarker) userMarker.setLatLng([lat, lon]);
    if (map && !opts.keepView) map.setView([lat, lon], opts.zoom || 12);
    renderAllNearbyStoresOnMap();
    if (lastQuery) searchProducts(lastQuery);
  }

  function initMap() {
    map = L.map('shopper-map', {
      zoomControl: true
    }).setView([currentLocation.lat, currentLocation.lon], 12);

    // OSM standard tiles: the familiar look, full street detail and Hebrew
    // labels for Israel, no API key. Attribution is required by OSM policy.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    const homeIcon = L.divIcon({
      className: 'map-home-pin',
      html: `<div style="background: var(--accent-cyan); width: 14px; height: 14px; border: 2px solid #111827; border-radius: 50%; box-shadow: 0 0 12px var(--accent-cyan);"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });

    userMarker = L.marker([currentLocation.lat, currentLocation.lon], { icon: homeIcon }).addTo(map);

    map.on('click', (e) => {
      setLocation(e.latlng.lat, e.latlng.lng, 'מיקום מסומן במפה', { keepView: true });
    });
  }

  // The map collapses into the location toolbar. Layers keep drawing while
  // hidden (cheap), but a hidden Leaflet container has zero size — so any
  // fitBounds must wait for invalidateSize after the drawer opens.
  function fitMapView() {
    if (!map || mapDrawer.hidden) return;
    map.invalidateSize();
    if (routeLines.length > 0) {
      map.fitBounds(routeLines[0].getBounds(), { padding: [30, 30] });
      return;
    }
    const nearby = getNearbyStores();
    if (nearby.length > 0) {
      const coords = [[currentLocation.lat, currentLocation.lon], ...nearby.map(s => [s.latitude, s.longitude])];
      map.fitBounds(L.latLngBounds(coords), { padding: [40, 40] });
    }
  }

  function setMapOpen(open) {
    mapOpen = open;
    writeJSON(KEYS.mapOpen, open);
    mapDrawer.hidden = !open;
    mapToggle.classList.toggle('active', open);
    if (open) requestAnimationFrame(fitMapView);
  }

  mapToggle.addEventListener('click', () => setMapOpen(!mapOpen));

  userLocationSelect.addEventListener('change', () => {
    const preset = cityPresets[userLocationSelect.value];
    if (preset) setLocation(preset.lat, preset.lon, preset.name);
  });

  // Address Geocoding Search
  const addressInput = document.getElementById('address-input');
  const lookupAddressBtn = document.getElementById('lookup-address-btn');
  const gpsLocationBtn = document.getElementById('gps-location-btn');

  async function lookupAddress() {
    const query = addressInput.value.trim();
    if (!query) return;

    lookupAddressBtn.innerText = 'מחפש...';
    lookupAddressBtn.disabled = true;

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=il`);
      const data = await res.json();

      if (data && data.length > 0) {
        setLocation(parseFloat(data[0].lat), parseFloat(data[0].lon), query, { zoom: 14 });
        addressInput.style.borderColor = 'var(--accent-green)';
        setTimeout(() => addressInput.style.borderColor = 'var(--border-color)', 2000);
      } else {
        toast('לא נמצא מיקום — נסה להוסיף עיר (לדוגמה: "הרצל 10, תל אביב")');
      }
    } catch (err) {
      console.error('Geocoding error:', err);
      toast('שגיאה בחיפוש הכתובת — בדוק את החיבור לרשת');
    } finally {
      lookupAddressBtn.innerText = 'אתר';
      lookupAddressBtn.disabled = false;
    }
  }

  lookupAddressBtn.addEventListener('click', lookupAddress);
  addressInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') lookupAddress();
  });

  const GPS_DEFAULT_HTML = '<i data-lucide="locate" style="width: 13px; height: 13px;"></i> זהה אותי';
  gpsLocationBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      toast('דפדפן זה אינו תומך בזיהוי מיקום GPS');
      return;
    }

    gpsLocationBtn.innerHTML = '<span class="spinner" style="width:12px; height:12px; border-color:var(--accent-cyan); border-top-color:transparent;"></span> מזהה...';
    gpsLocationBtn.disabled = true;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation(position.coords.latitude, position.coords.longitude, 'המיקום הנוכחי שלי (GPS)', { zoom: 14 });
        gpsLocationBtn.innerHTML = '<i data-lucide="check" style="width: 13px; height: 13px; color:var(--accent-green)"></i> זוהה!';
        lucide.createIcons();
        setTimeout(() => {
          gpsLocationBtn.innerHTML = GPS_DEFAULT_HTML;
          gpsLocationBtn.disabled = false;
          lucide.createIcons();
        }, 2500);
      },
      (error) => {
        console.error('GPS error:', error);
        toast('לא ניתן לזהות מיקום — ודא שאישרת הרשאות מיקום');
        gpsLocationBtn.innerHTML = GPS_DEFAULT_HTML;
        gpsLocationBtn.disabled = false;
        lucide.createIcons();
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });

  // Haversine Distance Calculator (km)
  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function getNearbyStores() {
    const maxDistLimit = parseFloat(maxDistanceSlider.value);
    return allStores.map(store => ({
      ...store,
      distance: calculateDistance(currentLocation.lat, currentLocation.lon, store.latitude, store.longitude)
    })).filter(store => store.distance <= maxDistLimit)
      .sort((a, b) => a.distance - b.distance);
  }

  // Square solid pin = geocoded street address; dashed circle = approximate
  // (city centroid — the chain feed had no usable address).
  function storeIcon(store) {
    const color = getChainColor(store.chain_id);
    if (store.geo_precision === 'address') {
      return L.divIcon({
        className: 'map-store-pin',
        html: `<div style="background: ${color}; width: 12px; height: 12px; border: 2px solid #111827; border-radius: 4px; box-shadow: 0 0 6px ${color};"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      });
    }
    return L.divIcon({
      className: 'map-store-pin',
      html: `<div style="background: ${color}b3; width: 11px; height: 11px; border: 2px dashed rgba(17,24,39,0.8); border-radius: 50%;"></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    });
  }

  function renderAllNearbyStoresOnMap() {
    if (!map) return;
    nearbyStoreMarkers.forEach(m => map.removeLayer(m));
    nearbyStoreMarkers = [];
    routeLines.forEach(l => map.removeLayer(l));
    routeLines = [];

    const nearby = getNearbyStores();

    // City-precision stores share their city's centroid; fan identical
    // coordinates into small rings so every pin is visible and clickable.
    // Distances and search keep using the true coordinates.
    const stacked = new Map();
    nearby.forEach(s => {
      const key = `${s.latitude.toFixed(5)},${s.longitude.toFixed(5)}`;
      if (!stacked.has(key)) stacked.set(key, []);
      stacked.get(key).push(s);
    });
    stacked.forEach(group => group.sort((a, b) => String(a.id).localeCompare(String(b.id))));

    nearby.forEach(store => {
      const key = `${store.latitude.toFixed(5)},${store.longitude.toFixed(5)}`;
      const group = stacked.get(key);
      let lat = store.latitude;
      let lon = store.longitude;
      if (group.length > 1) {
        const idx = group.findIndex(s => s.id === store.id);
        const ring = Math.floor(idx / 12) + 1;
        const angle = (2 * Math.PI * (idx % 12)) / 12 + ring * 0.26;
        lat += 0.0011 * ring * Math.sin(angle);
        lon += 0.0011 * ring * Math.cos(angle) / Math.cos(lat * Math.PI / 180);
      }
      const approx = store.geo_precision !== 'address';

      const marker = L.marker([lat, lon], { icon: storeIcon(store) })
        .bindPopup(`
          <div style="direction:rtl; text-align:right; font-family:'Rubik'; font-size:12px; color:var(--text-primary); line-height: 1.4;">
            <strong>${getChainNameHebrew(store.chain_id)} (${store.name})</strong><br>
            <span style="color:var(--text-secondary); font-size:11px;">מרחק: ${store.distance.toFixed(1)} ק"מ</span>
            ${approx ? '<br><span style="color:var(--accent-yellow); font-size:10px;">מיקום משוער — מרכז העיר</span>' : ''}
          </div>
        `, { closeButton: false })
        .addTo(map);

      nearbyStoreMarkers.push(marker);
    });

    if (nearby.length > 0 && !mapDrawer.hidden) {
      const coords = [[currentLocation.lat, currentLocation.lon], ...nearby.map(s => [s.latitude, s.longitude])];
      map.fitBounds(L.latLngBounds(coords), { padding: [40, 40] });
    }
  }

  // ----- autocomplete + live search -----

  const runSuggest = debounce(async () => {
    const q = productSearchInput.value.trim();
    if (q.length < 2) {
      suggestDropdown.classList.remove('open');
      return;
    }
    try {
      const res = await fetch(`/api/v1/search/suggest?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!data.success || !data.data.length) {
        suggestDropdown.classList.remove('open');
        return;
      }
      suggestDropdown.innerHTML = '';
      data.data.forEach(item => {
        const row = document.createElement('div');
        row.className = 'suggest-item';
        row.innerHTML = `<span class="suggest-name"></span><span class="suggest-brand"></span>`;
        row.querySelector('.suggest-name').textContent = item.name;
        row.querySelector('.suggest-brand').textContent = item.brand || '';
        row.addEventListener('click', () => {
          productSearchInput.value = item.name;
          suggestDropdown.classList.remove('open');
          searchProducts(item.name);
        });
        suggestDropdown.appendChild(row);
      });
      suggestDropdown.classList.add('open');
    } catch (err) {
      suggestDropdown.classList.remove('open');
    }
  }, 200);

  // Live search: results refresh while you type, without pressing anything.
  const runLiveSearch = debounce(() => {
    const q = productSearchInput.value.trim();
    if (q.length >= 2) searchProducts(q, { keepSuggest: true });
  }, 650);

  productSearchInput.addEventListener('input', () => {
    runSuggest();
    runLiveSearch();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-input-wrapper')) suggestDropdown.classList.remove('open');
  });

  // ----- chips: categories, promos-only, recent searches -----

  categoryChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-q]');
    if (!chip) return;
    productSearchInput.value = chip.dataset.q;
    searchProducts(chip.dataset.q);
  });

  promoFilterChip.addEventListener('click', () => {
    promoOnly = !promoOnly;
    promoFilterChip.classList.toggle('active', promoOnly);
    renderProducts(lastResults);
  });

  function pushRecent(query) {
    recentSearches = [query, ...recentSearches.filter(q => q !== query)].slice(0, 6);
    writeJSON(KEYS.recent, recentSearches);
    renderRecentChips();
  }

  function renderRecentChips() {
    if (!recentSearches.length) {
      recentChips.hidden = true;
      return;
    }
    recentChips.hidden = false;
    recentChips.innerHTML = '<span class="recent-label">חיפושים אחרונים:</span>';
    recentSearches.forEach(q => {
      const chip = document.createElement('button');
      chip.className = 'chip chip-recent';
      chip.textContent = q;
      chip.addEventListener('click', () => {
        productSearchInput.value = q;
        searchProducts(q);
      });
      recentChips.appendChild(chip);
    });
  }

  // ----- sort toggle -----

  function applySortUI() {
    sortToggle.querySelectorAll('[data-sort]').forEach(b =>
      b.classList.toggle('active', b.dataset.sort === currentSort));
  }

  sortToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sort]');
    if (!btn) return;
    currentSort = btn.dataset.sort;
    writeJSON(KEYS.sort, currentSort);
    applySortUI();
    if (lastQuery) searchProducts(lastQuery);
  });

  // ----- product search (server-side, cheapest-nearby-first) -----

  function renderSkeletons(n = 6) {
    searchResults.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const sk = document.createElement('div');
      sk.className = 'product-card skeleton-card';
      sk.innerHTML = `
        <div class="sk-line w60"></div>
        <div class="sk-line w90"></div>
        <div class="sk-block"></div>
        <div class="sk-line w40"></div>`;
      searchResults.appendChild(sk);
    }
  }

  async function searchProducts(query, opts = {}) {
    try {
      runSuggest.cancel();
      runLiveSearch.cancel();
      if (!opts.keepSuggest) suggestDropdown.classList.remove('open');
      lastQuery = query;
      renderSkeletons();
      resultsContext.textContent = '';

      const radius = parseFloat(maxDistanceSlider.value);
      const params = new URLSearchParams({
        q: query,
        lat: currentLocation.lat,
        lon: currentLocation.lon,
        radius_km: radius,
        sort: currentSort,
        limit: 60
      });
      const res = await fetch(`/api/v1/search?${params}`);
      const data = await res.json();

      if (!data.success) {
        searchResults.innerHTML = '<div class="loading-placeholder">שגיאה בביצוע החיפוש</div>';
        return;
      }

      lastResults = data.data || [];
      if (lastResults.length > 0) pushRecent(query);

      const nearbyCount = getNearbyStores().length;
      resultsContext.textContent = lastResults.length
        ? `${lastResults.length} מוצרים · ${nearbyCount} סניפים ברדיוס ${radius} ק"מ`
        : '';

      if (data.count === 0) {
        searchResults.innerHTML = `
          <div class="loading-placeholder">
            ${data.message || 'לא נמצאו מוצרים תואמים בסניפים שברדיוס'}<br>
            <span class="empty-hint">נסו להגדיל את הרדיוס, לבדוק את המיקום, או לחפש מילה אחת (לדוגמה: "חלב")</span>
          </div>`;
        return;
      }

      renderProducts(lastResults);
    } catch (err) {
      console.error(err);
      searchResults.innerHTML = '<div class="loading-placeholder">שגיאה בביצוע החיפוש</div>';
    }
  }

  function cartItemFor(barcode) {
    return cart.find(i => i.barcode === barcode);
  }

  function renderProducts(productList) {
    searchResults.innerHTML = '';

    let rows = productList;
    if (promoOnly) rows = rows.filter(r => r.is_promo);

    if (!rows.length) {
      searchResults.innerHTML = `<div class="loading-placeholder">${
        promoOnly ? 'אין מבצעים בתוצאות האלה — נסו חיפוש אחר או כבו את הסינון' : 'לא נמצאו מוצרים'
      }</div>`;
      return;
    }

    // The single best value-per-100g among comparable (weight/volume) results
    let bestUnitBarcode = null;
    let bestUnitVal = Infinity;
    rows.forEach(r => {
      if (isMeasurable(r.unit_of_measure) && r.best_unit_price > 0 && r.best_unit_price < bestUnitVal) {
        bestUnitVal = r.best_unit_price;
        bestUnitBarcode = r.barcode;
      }
    });

    rows.forEach(prod => {
      const card = document.createElement('div');
      card.className = 'product-card';
      card.dataset.barcode = prod.barcode;

      const chainColor = getChainColor(prod.best_store_chain_id);
      const hasPromo = !!prod.is_promo;
      const distance = prod.best_store_distance_km != null
        ? `· ${prod.best_store_distance_km.toFixed(1)} ק"מ` : '';
      const rangeText = prod.store_count > 1
        ? `₪${prod.best_price.toFixed(2)}–₪${prod.max_price.toFixed(2)} ב-${prod.store_count} סניפים`
        : 'סניף אחד ברדיוס';
      const savePct = prod.store_count > 1 && prod.max_price > prod.best_price
        ? Math.round((1 - prod.best_price / prod.max_price) * 100) : 0;

      card.innerHTML = `
        ${prod.barcode === bestUnitBarcode ? '<div class="best-value-ribbon">🏆 המשתלם ביותר ' + unitPriceLabel(prod.unit_of_measure) + '</div>' : ''}
        <div class="product-meta">
          <span class="product-brand-tag"></span>
          <h4 class="product-title"></h4>
          <span class="product-weight"></span>
        </div>

        <div class="best-price-box ${hasPromo ? 'has-promo' : ''}">
          <div class="best-price-row">
            <span class="best-price">₪${prod.best_price.toFixed(2)}</span>
            ${hasPromo ? `<span class="regular-price-strike">₪${prod.best_regular_price.toFixed(2)}</span>` : ''}
            ${hasPromo ? '<span class="promo-pill">מבצע</span>' : ''}
            ${hasPromo && prod.requires_club ? '<span class="club-pill">מועדון</span>' : ''}
            ${savePct >= 5 ? `<span class="save-pill">זול ב-${savePct}% מהיקר</span>` : ''}
          </div>
          <div class="best-store-row">
            <span class="chain-dot" style="background: ${chainColor};"></span>
            <span class="best-store-text"></span>
          </div>
          ${hasPromo && prod.promo_description ? `<div class="promo-desc-row"></div>` : ''}
          <div class="price-meta-row">
            <span class="range-text">${rangeText}</span>
            <span class="unit-text">₪${(prod.best_unit_price ?? 0).toFixed(2)} ${unitPriceLabel(prod.unit_of_measure)}</span>
          </div>
        </div>

        <div class="card-actions"></div>
        <div class="store-prices-list compare-list" hidden></div>
      `;

      // textContent for feed-sourced strings (defense against markup in names)
      card.querySelector('.product-brand-tag').textContent =
        [prod.brand, prod.manufacturer].filter(Boolean).join(' | ') || 'ללא מותג';
      card.querySelector('.product-title').textContent = prod.name;
      card.querySelector('.product-weight').textContent =
        `גודל: ${prod.unit_qty || '?'} ${prod.unit_of_measure || ''} | ברקוד: ${prod.barcode}`;
      card.querySelector('.best-store-text').textContent =
        `${prod.best_store_chain || ''} ${prod.best_store_name || ''} ${distance}`;
      if (hasPromo && prod.promo_description) {
        card.querySelector('.promo-desc-row').textContent = prod.promo_description +
          (prod.promo_end ? ` (עד ${prod.promo_end.slice(0, 10)})` : '');
      }

      renderCardActions(card, prod);
      searchResults.appendChild(card);
    });

    lucide.createIcons();
  }

  // Card action area: add button, or a qty stepper when already in the cart.
  function renderCardActions(card, prod) {
    const actions = card.querySelector('.card-actions');
    const inCart = cartItemFor(prod.barcode);

    if (inCart) {
      actions.innerHTML = `
        <div class="card-stepper">
          <button class="step-btn step-minus">−</button>
          <span class="step-qty">${inCart.qty} בעגלה</span>
          <button class="step-btn step-plus">+</button>
        </div>
        <button class="btn-compare">
          <i data-lucide="bar-chart-3" style="width: 14px; height: 14px;"></i>
          השוואת סניפים
        </button>`;
      actions.querySelector('.step-plus').addEventListener('click', () => {
        updateCartQty(prod.barcode, 1);
        renderCardActions(card, prod);
      });
      actions.querySelector('.step-minus').addEventListener('click', () => {
        updateCartQty(prod.barcode, -1);
        renderCardActions(card, prod);
      });
    } else {
      actions.innerHTML = `
        <button class="btn-add-cart">
          <i data-lucide="plus" style="width: 14px; height: 14px;"></i>
          הוסף לעגלה
        </button>
        <button class="btn-compare">
          <i data-lucide="bar-chart-3" style="width: 14px; height: 14px;"></i>
          השוואת סניפים
        </button>`;
      actions.querySelector('.btn-add-cart').addEventListener('click', () => {
        addToCart(prod);
        const short = prod.name.length > 30 ? prod.name.slice(0, 30) + '…' : prod.name;
        toast(`✓ ${short} נוסף לעגלה`);
        renderCardActions(card, prod);
      });
    }
    actions.querySelector('.btn-compare').addEventListener('click', () => toggleCompare(card, prod));
    lucide.createIcons();
  }

  // Lazy per-product branch comparison via the batch endpoint + price history.
  async function toggleCompare(card, prod) {
    const list = card.querySelector('.compare-list');
    if (!list.hidden) {
      list.hidden = true;
      return;
    }
    list.hidden = false;
    list.innerHTML = '<div class="loading-placeholder" style="padding:8px;">טוען מחירים מכל הסניפים...</div>';

    const nearby = getNearbyStores();
    const distById = new Map(nearby.map(s => [s.id, s.distance]));
    try {
      const [batchRes, histRes] = await Promise.all([
        fetch('/api/v1/prices/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            barcodes: [prod.barcode],
            store_ids: nearby.slice(0, 600).map(s => s.id)
          })
        }).then(r => r.json()),
        fetch(`/api/v1/products/${prod.barcode}/history?store_id=${encodeURIComponent(prod.best_store_id)}&limit=5`)
          .then(r => r.json()).catch(() => null)
      ]);

      if (!batchRes.success || !batchRes.data.length) {
        list.innerHTML = '<div class="loading-placeholder" style="padding:8px;">אין מחירים זמינים</div>';
        return;
      }

      list.innerHTML = '';

      // Price-drop intelligence from the history table
      const hist = histRes && histRes.success ? histRes.data : [];
      if (hist.length >= 2 && hist[0].price < hist[1].price) {
        const drop = document.createElement('div');
        drop.className = 'price-drop-note';
        drop.textContent = `📉 המחיר בסניף הזול ירד מ-₪${hist[1].price.toFixed(2)} ל-₪${hist[0].price.toFixed(2)} (${hist[0].changed_at.slice(0, 10)})`;
        list.appendChild(drop);
      }

      const rows = batchRes.data.sort((a, b) => a.effective_price - b.effective_price);
      rows.forEach((p, idx) => {
        const row = document.createElement('div');
        row.className = `store-price-row ${idx === 0 ? 'cheapest-row' : ''}`;
        const dist = distById.get(p.store_id);
        const multibuy = p.multibuy_qty
          ? `<span class="multibuy-note">${p.multibuy_qty} ב-₪${p.multibuy_total.toFixed(2)}</span>` : '';
        row.innerHTML = `
          <div class="store-info-col">
            <span class="chain-dot" style="background: ${getChainColor(p.chain_id)};"></span>
            <span class="store-name-text"></span>
            <span class="store-dist-text">${dist != null ? `(${dist.toFixed(1)} ק"מ)` : ''}</span>
          </div>
          <div class="price-col">
            ${idx === 0 ? '<span class="cheapest-tag">הכי זול</span>' : ''}
            ${p.is_promo ? '<span class="promo-pill small">מבצע</span>' : ''}
            ${multibuy}
            <span class="price-val">₪${p.effective_price.toFixed(2)}</span>
            ${p.is_promo ? `<span class="regular-price-strike small">₪${p.price.toFixed(2)}</span>` : ''}
          </div>
        `;
        row.querySelector('.store-name-text').textContent = `${p.chain_name} (${p.store_name})`;
        list.appendChild(row);
      });
    } catch (err) {
      list.innerHTML = '<div class="loading-placeholder" style="padding:8px;">שגיאה בטעינת המחירים</div>';
    }
  }

  // ----- shopping cart (persisted, with price estimates) -----

  function saveCart() {
    writeJSON(KEYS.cart, cart);
  }

  function addToCart(product) {
    const existing = cartItemFor(product.barcode);
    if (existing) {
      existing.qty += 1;
      if (product.best_price != null) existing.price = product.best_price;
    } else {
      cart.push({
        barcode: product.barcode,
        name: product.name,
        qty: 1,
        price: product.best_price ?? null // indicative: cheapest nearby at add time
      });
    }
    saveCart();
    renderCart();
  }

  function renderCart() {
    cartList.innerHTML = '';
    const totalItems = cart.reduce((s, i) => s + i.qty, 0);
    cartCount.hidden = totalItems === 0;
    cartCount.textContent = totalItems;

    if (cart.length === 0) {
      emptyCartMsg.style.display = 'block';
      cartSummary.hidden = true;
      return;
    }
    emptyCartMsg.style.display = 'none';

    let total = 0;
    let allPriced = true;

    cart.forEach(item => {
      const li = document.createElement('li');
      li.className = 'cart-item';
      const lineTotal = item.price != null ? item.price * item.qty : null;
      if (lineTotal != null) total += lineTotal; else allPriced = false;

      li.innerHTML = `
        <div class="cart-item-info">
          <span class="cart-item-name"></span>
          <span class="cart-item-price">${lineTotal != null ? `₪${lineTotal.toFixed(2)}` : ''}</span>
        </div>
        <div class="cart-item-actions">
          <button class="cart-qty-btn minus">-</button>
          <span class="cart-item-qty">${item.qty}</span>
          <button class="cart-qty-btn plus">+</button>
          <button class="cart-remove-btn">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
          </button>
        </div>
      `;
      li.querySelector('.cart-item-name').textContent = item.name;
      li.querySelector('.minus').addEventListener('click', () => updateCartQty(item.barcode, -1));
      li.querySelector('.plus').addEventListener('click', () => updateCartQty(item.barcode, 1));
      li.querySelector('.cart-remove-btn').addEventListener('click', () => removeFromCart(item.barcode));
      cartList.appendChild(li);
    });

    cartSummary.hidden = false;
    cartTotal.textContent = `₪${total.toFixed(2)}${allPriced ? '' : '+'}`;

    lucide.createIcons();
  }

  function updateCartQty(barcode, change) {
    const item = cartItemFor(barcode);
    if (!item) return;
    item.qty += change;
    if (item.qty <= 0) {
      removeFromCart(barcode);
    } else {
      saveCart();
      renderCart();
    }
  }

  function removeFromCart(barcode) {
    cart = cart.filter(i => i.barcode !== barcode);
    saveCart();
    renderCart();
    // refresh stepper state on a visible card, if any
    const card = searchResults.querySelector(`.product-card[data-barcode="${CSS.escape(barcode)}"]`);
    if (card) {
      const prod = lastResults.find(r => r.barcode === barcode);
      if (prod) renderCardActions(card, prod);
    }
  }

  // ----- distance slider -----

  const debouncedMapRender = debounce(renderAllNearbyStoresOnMap, 250);
  maxDistanceSlider.addEventListener('input', () => {
    distanceValSpan.innerText = `${maxDistanceSlider.value} ק"מ`;
    debouncedMapRender();
  });

  maxDistanceSlider.addEventListener('change', () => {
    writeJSON(KEYS.radius, parseFloat(maxDistanceSlider.value));
    if (lastQuery) searchProducts(lastQuery);
  });

  // ----- route drawing -----

  function drawRouteOnMap(route, userLoc, opts = {}) {
    routeLines.forEach(l => map.removeLayer(l));
    mapStoreMarkers.forEach(m => map.removeLayer(m));
    routeLines = [];
    mapStoreMarkers = [];

    if (!route || route.length === 0) return;

    const coords = [[userLoc.lat, userLoc.lon]];

    route.forEach((store, idx) => {
      coords.push([store.latitude, store.longitude]);

      const itemsBought = currentOptimalPurchases[store.id] || [];
      const itemsListStr = itemsBought.map(i => `${i.name} (x${i.qty})`).join('<br>');

      const marker = L.marker([store.latitude, store.longitude], { icon: storeIcon(store) })
        .bindPopup(`
          <div style="direction:rtl; text-align:right; font-family:'Rubik'; font-size:12px; color:var(--text-primary);">
            <strong>תחנה ${idx + 1}: ${getChainNameHebrew(store.chain_id)} (${store.name})</strong><br>
            <span style="color:var(--text-secondary); font-size:11px;">פריטים לקנייה:</span><br>
            <span style="color:var(--accent-cyan); font-weight:500;">${itemsListStr || 'אין פריטים'}</span>
          </div>
        `, { closeButton: false })
        .addTo(map);

      mapStoreMarkers.push(marker);
    });

    coords.push([userLoc.lat, userLoc.lon]);

    const polyline = L.polyline(coords, {
      color: 'var(--accent-cyan)',
      weight: 3,
      opacity: 0.7,
      dashArray: '5, 8'
    }).addTo(map);

    routeLines.push(polyline);

    if (opts.forceOpen && mapDrawer.hidden) {
      setMapOpen(true); // fits to the new route after invalidateSize
    } else if (!mapDrawer.hidden) {
      requestAnimationFrame(() => {
        map.invalidateSize();
        map.fitBounds(L.latLngBounds(coords), { padding: [30, 30] });
      });
    }
    if (!mapDrawer.hidden && mapStoreMarkers.length > 0) mapStoreMarkers[0].openPopup();
  }

  let currentOptimalPurchases = {};

  // ----- basket optimization -----
  // One batch call for the whole cart, exhaustive 1/2/3-store combos over a
  // candidate pool, plus the headline savings stat: the same basket at the
  // cheapest vs the priciest nearby store.

  optimizeBtn.addEventListener('click', async () => {
    if (cart.length === 0) {
      routesContainer.innerHTML = `
        <div class="routing-placeholder-msg" style="color: var(--accent-red);">
          <i data-lucide="alert-circle"></i>
          נא להוסיף מוצרים לעגלת הקניות תחילה.
        </div>
      `;
      lucide.createIcons();
      return;
    }

    routesContainer.innerHTML = '<div class="routing-placeholder-msg">מחשב מסלולי נסיעה ומתמחר סלים אופטימליים...</div>';

    const userLoc = currentLocation;
    const maxDistLimit = parseFloat(maxDistanceSlider.value);
    const nearStores = getNearbyStores();

    if (nearStores.length === 0) {
      routesContainer.innerHTML = `
        <div class="routing-placeholder-msg" style="color:var(--accent-red);">
          <i data-lucide="info"></i>
          לא נמצאו סניפים ברדיוס של ${maxDistLimit} ק"מ. נסה להגדיל את המרחק המבוקש.
        </div>
      `;
      lucide.createIcons();
      return;
    }

    try {
      const res = await fetch('/api/v1/prices/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barcodes: cart.map(i => i.barcode),
          store_ids: nearStores.slice(0, 600).map(s => s.id)
        })
      });
      const payload = await res.json();
      if (!payload.success) throw new Error(payload.error || 'batch pricing failed');

      const priceMap = new Map();
      payload.data.forEach(rec => {
        if (!priceMap.has(rec.barcode)) priceMap.set(rec.barcode, new Map());
        priceMap.get(rec.barcode).set(rec.store_id, rec);
      });

      // Candidate pool: the 8 cheapest stores per item, capped at 25 total.
      const poolIds = new Set();
      cart.forEach(item => {
        const stores = priceMap.get(item.barcode);
        if (!stores) return;
        [...stores.values()]
          .sort((a, b) => a.effective_price - b.effective_price)
          .slice(0, 8)
          .forEach(rec => poolIds.add(rec.store_id));
      });
      let pool = nearStores.filter(s => poolIds.has(s.id));
      if (pool.length > 25) pool = pool.slice(0, 25);

      if (pool.length === 0) {
        routesContainer.innerHTML = `
          <div class="routing-placeholder-msg" style="color:var(--accent-red);">
            <i data-lucide="package-x"></i>
            אף אחד מהמוצרים בעגלה אינו זמין בסניפים שברדיוס.
          </div>
        `;
        lucide.createIcons();
        return;
      }

      const pairDist = new Map();
      const pairKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
      for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
          pairDist.set(pairKey(pool[i].id, pool[j].id),
            calculateDistance(pool[i].latitude, pool[i].longitude,
                              pool[j].latitude, pool[j].longitude));
        }
      }
      const distBetween = (a, b) => pairDist.get(pairKey(a.id, b.id)) || 0;

      const DRIVING_COST_PER_KM = 1.5;
      const OUT_OF_STOCK_PENALTY = 50.0;

      function evaluateStoreSet(storeSet, type) {
        let totalItemsCost = 0;
        const missingItems = [];
        const purchaseListByStore = {};
        storeSet.forEach(s => purchaseListByStore[s.id] = []);

        cart.forEach(cartItem => {
          let cheapest = Infinity;
          let targetStoreId = null;
          let promo = false;

          storeSet.forEach(store => {
            const rec = priceMap.get(cartItem.barcode)?.get(store.id);
            if (rec && rec.effective_price < cheapest) {
              cheapest = rec.effective_price;
              targetStoreId = store.id;
              promo = !!rec.is_promo;
            }
          });

          if (targetStoreId !== null) {
            const cost = cheapest * cartItem.qty;
            totalItemsCost += cost;
            purchaseListByStore[targetStoreId].push({
              name: cartItem.name, qty: cartItem.qty,
              price: cheapest, total: cost, promo
            });
          } else {
            missingItems.push(cartItem.name);
            totalItemsCost += OUT_OF_STOCK_PENALTY * cartItem.qty;
          }
        });

        let bestDistance = Infinity;
        let bestRouteSeq = [];

        if (storeSet.length === 1) {
          bestDistance = storeSet[0].distance * 2;
          bestRouteSeq = [storeSet[0]];
        } else if (storeSet.length === 2) {
          bestDistance = storeSet[0].distance + distBetween(storeSet[0], storeSet[1]) + storeSet[1].distance;
          bestRouteSeq = [storeSet[0], storeSet[1]];
        } else if (storeSet.length === 3) {
          [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].forEach(p => {
            const [s0, s1, s2] = [storeSet[p[0]], storeSet[p[1]], storeSet[p[2]]];
            const totalD = s0.distance + distBetween(s0, s1) + distBetween(s1, s2) + s2.distance;
            if (totalD < bestDistance) {
              bestDistance = totalD;
              bestRouteSeq = [s0, s1, s2];
            }
          });
        }

        const travelCost = bestDistance * DRIVING_COST_PER_KM;
        return {
          type, storeSet, route: bestRouteSeq,
          totalDistance: bestDistance,
          totalItemCost: totalItemsCost - (missingItems.length * OUT_OF_STOCK_PENALTY),
          travelCost,
          totalCost: totalItemsCost + travelCost,
          missingItems,
          purchases: purchaseListByStore
        };
      }

      const options = [];

      // Singles: keep them all — the spread between cheapest and priciest
      // store for the SAME basket is the product's whole argument.
      const singles = pool.map(s => evaluateStoreSet([s], 'single'));
      let bestSingle = null;
      singles.forEach(option => {
        if (!bestSingle || option.totalCost < bestSingle.totalCost) bestSingle = option;
      });
      if (bestSingle) options.push(bestSingle);

      if (pool.length >= 2) {
        let bestDouble = null;
        for (let i = 0; i < pool.length; i++) {
          for (let j = i + 1; j < pool.length; j++) {
            const option = evaluateStoreSet([pool[i], pool[j]], 'double');
            if (!bestDouble || option.totalCost < bestDouble.totalCost) bestDouble = option;
          }
        }
        if (bestDouble) options.push(bestDouble);
      }

      if (pool.length >= 3) {
        let bestTriple = null;
        for (let i = 0; i < pool.length; i++) {
          for (let j = i + 1; j < pool.length; j++) {
            for (let k = j + 1; k < pool.length; k++) {
              const option = evaluateStoreSet([pool[i], pool[j], pool[k]], 'triple');
              if (!bestTriple || option.totalCost < bestTriple.totalCost) bestTriple = option;
            }
          }
        }
        if (bestTriple) options.push(bestTriple);
      }

      if (options.length === 0) {
        routesContainer.innerHTML = '<div class="routing-placeholder-msg">שגיאה בחישוב המסלולים.</div>';
        return;
      }

      options.sort((a, b) => a.totalCost - b.totalCost);

      routesContainer.innerHTML = '';

      // Savings headline: the same FULL basket priced at every nearby store
      // (all batch data, not just the optimizer pool) — cheapest vs priciest
      // among stores that carry every item. This is the competition stat.
      const qtyByBarcode = new Map(cart.map(i => [i.barcode, i.qty]));
      const basketByStore = new Map();
      payload.data.forEach(rec => {
        const agg = basketByStore.get(rec.store_id) || { sum: 0, items: 0 };
        agg.sum += rec.effective_price * (qtyByBarcode.get(rec.barcode) || 1);
        agg.items += 1;
        basketByStore.set(rec.store_id, agg);
      });
      const fullCoverage = [...basketByStore.entries()]
        .filter(([, v]) => v.items === cart.length)
        .sort((a, b) => a[1].sum - b[1].sum);
      if (fullCoverage.length >= 2) {
        const [cheapId, cheap] = fullCoverage[0];
        const [dearId, dear] = fullCoverage[fullCoverage.length - 1];
        const saving = dear.sum - cheap.sum;
        if (saving >= 1) {
          const pct = Math.round(saving / dear.sum * 100);
          const storeName = (id) => {
            const s = nearStores.find(st => st.id === id);
            return s ? `${getChainNameHebrew(s.chain_id)} ${s.name}` : id;
          };
          const banner = document.createElement('div');
          banner.className = 'savings-banner';
          banner.innerHTML = `
            <i data-lucide="trending-down" style="width:16px;height:16px;"></i>
            <div>
              <strong>אותו סל בדיוק</strong> (${cart.length} מוצרים, ${fullCoverage.length} סניפים עם הכל):
              ₪${cheap.sum.toFixed(2)} ב<span class="cheap-store"></span>
              לעומת ₪${dear.sum.toFixed(2)} ב<span class="dear-store"></span>
              — <strong>חיסכון של ₪${saving.toFixed(2)} (${pct}%)</strong>
            </div>`;
          banner.querySelector('.cheap-store').textContent = storeName(cheapId);
          banner.querySelector('.dear-store').textContent = storeName(dearId);
          routesContainer.appendChild(banner);
        }
      }

      options.forEach((opt, idx) => {
        const isOverallCheapest = idx === 0;
        const card = document.createElement('div');

        let typeBadge = '';
        let typeTitle = '';
        let cardBorderClass = '';

        if (opt.type === 'single') {
          typeTitle = 'ביקור בחנות אחת';
          typeBadge = 'single';
          cardBorderClass = 'single';
        } else if (opt.type === 'double') {
          typeTitle = 'פיצול ל-2 חנויות';
          typeBadge = 'double';
          cardBorderClass = 'double';
        } else {
          typeTitle = 'פיצול ל-3 חנויות';
          typeBadge = 'double';
          cardBorderClass = 'double';
        }

        if (isOverallCheapest) {
          typeBadge = 'cheapest';
          cardBorderClass = 'cheapest';
        }

        card.className = `route-card ${cardBorderClass}`;

        let stepsHtml = '';
        opt.route.forEach((store, stepIdx) => {
          const itemsBought = opt.purchases[store.id] || [];
          let itemsListStr = itemsBought
            .map(i => `${i.name} (x${i.qty}) - ₪${(i.price * i.qty).toFixed(2)}${i.promo ? ' 🏷️' : ''}`)
            .join(', ');

          if (itemsBought.length === 0) {
            itemsListStr = '<span style="color:var(--text-muted);">אין פריטים לקנייה בסניף זה</span>';
          }

          stepsHtml += `
            <div class="route-step">
              <div class="route-step-header">
                <span class="route-step-store">תחנה ${stepIdx + 1}: ${getChainNameHebrew(store.chain_id)} (${store.name})</span>
                <span class="route-step-dist">${store.distance.toFixed(1)} ק"מ</span>
              </div>
              <div class="route-step-items">
                <strong>פריטים:</strong> ${itemsListStr}
              </div>
            </div>
          `;
        });

        let missingItemsHtml = '';
        if (opt.missingItems.length > 0) {
          missingItemsHtml = `
            <div style="font-size: 11px; color: var(--accent-red); margin-top: 4px; display:flex; align-items:center; gap:4px;">
              <i data-lucide="package-x" style="width:12px; height:12px;"></i>
              <strong>חסר בסניפים אלו:</strong> ${opt.missingItems.join(', ')}
            </div>
          `;
        }

        const originCoords = `${userLoc.lat},${userLoc.lon}`;
        const waypointsStr = opt.route.map(store => `${store.latitude},${store.longitude}`).join('|');
        const gmapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${originCoords}&destination=${originCoords}&waypoints=${encodeURIComponent(waypointsStr)}&travelmode=driving`;

        card.innerHTML = `
          <div class="route-header">
            <div class="route-type-title">
              <i data-lucide="navigation"></i>
              ${typeTitle}
            </div>
            <span class="route-badge ${typeBadge}">
              ${isOverallCheapest ? '<i data-lucide="sparkles" style="width:12px; height:12px; vertical-align:middle; margin-left:4px;"></i>המשתלם ביותר' : 'מסלול אלטרנטיבי'}
            </span>
          </div>

          <div class="route-details">
            ${stepsHtml}
          </div>

          ${missingItemsHtml}

          <div class="route-totals">
            <div class="total-distance-label">
              <i data-lucide="route" style="width:14px; height:14px;"></i>
              מסלול מעגלי: <strong>${opt.totalDistance.toFixed(1)} ק"מ</strong>
              <span style="font-size:10px; color:var(--text-muted);">(דלק: ₪${opt.travelCost.toFixed(2)})</span>
            </div>
            <div class="total-price-label">
              סך הכל: <span class="total-price-val">₪${opt.totalCost.toFixed(2)}</span>
            </div>
          </div>

          <div class="route-actions" style="margin-top: 8px; display: flex; gap: 8px;">
            <a href="${gmapsUrl}" target="_blank" class="nav-gmaps-btn" style="flex: 1; text-align: center; text-decoration: none; padding: 8px 12px; font-size: 12px; font-weight: 600; border-radius: 6px; display: flex; align-items: center; justify-content: center; gap: 6px; background: rgba(16, 185, 129, 0.1); color: var(--accent-green); border: 1px solid rgba(16, 185, 129, 0.2); transition: all 0.2s;">
              <i data-lucide="map-pin" style="width:14px; height:14px;"></i>
              פתח ניווט ב-Google Maps
            </a>
            <button class="btn-draw-map" style="flex: 1; border: 1px solid var(--border-color); background: rgba(255, 255, 255, 0.05); color: var(--text-primary); border-radius: 6px; font-size:12px; font-weight:600; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">
              <i data-lucide="map" style="width:14px; height:14px;"></i>
              הצג מסלול במפה
            </button>
          </div>
        `;

        card.querySelector('.btn-draw-map').addEventListener('click', () => {
          currentOptimalPurchases = opt.purchases;
          drawRouteOnMap(opt.route, userLoc, { forceOpen: true });
          mapDrawer.scrollIntoView({ behavior: 'smooth', block: 'center' });
          document.querySelectorAll('.route-card').forEach(c => c.style.borderColor = 'var(--border-color)');
          card.style.borderColor = 'var(--accent-cyan)';
        });

        if (isOverallCheapest) {
          currentOptimalPurchases = opt.purchases;
          drawRouteOnMap(opt.route, userLoc);
        }

        routesContainer.appendChild(card);
      });

      lucide.createIcons();
    } catch (err) {
      console.error(err);
      routesContainer.innerHTML = '<div class="routing-placeholder-msg" style="color:var(--accent-red);">שגיאה בתמחור וניתוב סל הקניות.</div>';
    }
  });

  searchBtn.addEventListener('click', () => {
    const q = productSearchInput.value.trim();
    if (q) searchProducts(q);
  });

  productSearchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchBtn.click();
  });

  // ----- init -----

  locLabel.textContent = currentLocation.label;
  distanceValSpan.innerText = `${maxDistanceSlider.value} ק"מ`;
  mapDrawer.hidden = !mapOpen;
  mapToggle.classList.toggle('active', mapOpen);
  applySortUI();
  renderRecentChips();
  initMap();

  Promise.all([loadChains(), loadStores()]).then(() => {
    renderCart();
    const startQuery = recentSearches[0] || 'קוטג';
    productSearchInput.value = startQuery;
    searchProducts(startQuery);
  });
});
