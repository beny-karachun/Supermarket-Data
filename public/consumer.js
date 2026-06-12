document.addEventListener('DOMContentLoaded', () => {
  // Init Lucide Icons
  lucide.createIcons();

  // DOM Elements
  const productSearchInput = document.getElementById('product-search');
  const searchBtn = document.getElementById('search-btn');
  const searchResults = document.getElementById('search-results');
  const suggestDropdown = document.getElementById('suggest-dropdown');
  const sortToggle = document.getElementById('sort-toggle');

  const cartList = document.getElementById('cart-list');
  const emptyCartMsg = document.getElementById('empty-cart-msg');
  const userLocationSelect = document.getElementById('user-location');
  const maxDistanceSlider = document.getElementById('max-distance');
  const distanceValSpan = document.getElementById('distance-val');
  const optimizeBtn = document.getElementById('optimize-btn');
  const routesContainer = document.getElementById('routes-container');

  // State
  const CART_KEY = 'shakufsal_cart';
  let cart = loadCart();
  let allStores = [];
  let chainMeta = {}; // chain_id -> { name, color } from /api/v1/chains
  let currentSort = 'cheapest';

  // Leaflet Map State
  let map;
  let userMarker;
  let routeLines = [];
  let mapStoreMarkers = [];
  let nearbyStoreMarkers = [];

  const locationCoordinates = {
    jerusalem: { lat: 31.7680, lon: 35.2100, name: 'ירושלים' },
    tel_aviv: { lat: 32.0800, lon: 34.7800, name: 'תל אביב' },
    rehovot: { lat: 31.9000, lon: 34.8100, name: 'רחובות' },
    haifa: { lat: 32.8000, lon: 35.0000, name: 'חיפה' }
  };
  let currentLocation = { ...locationCoordinates.jerusalem };

  function debounce(fn, ms) {
    let t;
    const wrapped = (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
    wrapped.cancel = () => clearTimeout(t);
    return wrapped;
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

  // ----- map -----

  function initMap() {
    map = L.map('shopper-map', {
      zoomControl: true,
      attributionControl: false
    }).setView([currentLocation.lat, currentLocation.lon], 12);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(map);

    const homeIcon = L.divIcon({
      className: 'map-home-pin',
      html: `<div style="background: var(--accent-cyan); width: 14px; height: 14px; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 12px var(--accent-cyan);"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });

    userMarker = L.marker([currentLocation.lat, currentLocation.lon], { icon: homeIcon }).addTo(map);

    map.on('click', (e) => {
      const { lat, lng } = e.latlng;
      updateStartLocation(lat, lng, true);
    });
  }

  function updateStartLocation(lat, lng, isFromMapClick = false) {
    currentLocation = { lat, lon: lng, name: 'מיקום נבחר' };
    userMarker.setLatLng([lat, lng]);

    if (isFromMapClick) {
      let customOpt = document.getElementById('custom-location-option');
      if (!customOpt) {
        customOpt = document.createElement('option');
        customOpt.id = 'custom-location-option';
        customOpt.value = 'custom';
        customOpt.innerText = '📍 מיקום מסומן במפה';
        userLocationSelect.appendChild(customOpt);
      }
      userLocationSelect.value = 'custom';
    } else {
      map.setView([lat, lng], 12);
    }

    renderAllNearbyStoresOnMap();

    const q = productSearchInput.value.trim();
    if (q) searchProducts(q);
  }

  userLocationSelect.addEventListener('change', () => {
    const locKey = userLocationSelect.value;
    if (locKey !== 'custom' && locationCoordinates[locKey]) {
      const coords = locationCoordinates[locKey];
      updateStartLocation(coords.lat, coords.lon, false);
    }
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
        const found = data[0];
        updateStartLocation(parseFloat(found.lat), parseFloat(found.lon), true);
        map.setView([parseFloat(found.lat), parseFloat(found.lon)], 14);
        addressInput.style.borderColor = 'var(--accent-green)';
        setTimeout(() => addressInput.style.borderColor = 'var(--border-color)', 2000);
      } else {
        alert('לא נמצא מיקום עבור הכתובת שהוזנה. נסה להוסיף עיר (לדוגמה: "הרצל 10, תל אביב")');
      }
    } catch (err) {
      console.error('Geocoding error:', err);
      alert('שגיאה בחיפוש הכתובת. בדוק את החיבור לרשת.');
    } finally {
      lookupAddressBtn.innerText = 'חפש';
      lookupAddressBtn.disabled = false;
    }
  }

  lookupAddressBtn.addEventListener('click', lookupAddress);
  addressInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') lookupAddress();
  });

  gpsLocationBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('דפדפן זה אינו תומך בזיהוי מיקום GPS.');
      return;
    }

    gpsLocationBtn.innerHTML = '<span class="spinner" style="width:12px; height:12px; border-color:var(--accent-cyan); border-top-color:transparent;"></span> מזהה...';
    gpsLocationBtn.disabled = true;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        updateStartLocation(position.coords.latitude, position.coords.longitude, true);
        map.setView([position.coords.latitude, position.coords.longitude], 14);

        gpsLocationBtn.innerHTML = '<i data-lucide="check" style="width: 12px; height: 12px; color:var(--accent-green)"></i> זוהה!';
        lucide.createIcons();
        setTimeout(() => {
          gpsLocationBtn.innerHTML = '<i data-lucide="locate" style="width: 12px; height: 12px;"></i> זהה מיקום (GPS)';
          gpsLocationBtn.disabled = false;
          lucide.createIcons();
        }, 3000);
      },
      (error) => {
        console.error('GPS error:', error);
        alert('לא ניתן לזהות מיקום. ודא שאישרת הרשאות מיקום בדפדפן.');
        gpsLocationBtn.innerHTML = '<i data-lucide="locate" style="width: 12px; height: 12px;"></i> זהה מיקום (GPS)';
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

  function renderAllNearbyStoresOnMap() {
    nearbyStoreMarkers.forEach(m => map.removeLayer(m));
    nearbyStoreMarkers = [];
    routeLines.forEach(l => map.removeLayer(l));
    routeLines = [];

    const nearby = getNearbyStores();

    nearby.forEach(store => {
      const storeColor = getChainColor(store.chain_id);
      const storeIcon = L.divIcon({
        className: 'map-store-pin',
        html: `<div style="background: ${storeColor}; width: 12px; height: 12px; border: 2px solid white; border-radius: 4px; box-shadow: 0 0 10px ${storeColor};"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      });

      const marker = L.marker([store.latitude, store.longitude], { icon: storeIcon })
        .bindPopup(`
          <div style="direction:rtl; text-align:right; font-family:'Rubik'; font-size:12px; color:var(--text-primary); line-height: 1.4;">
            <strong>${getChainNameHebrew(store.chain_id)} (${store.name})</strong><br>
            <span style="color:var(--text-secondary); font-size:11px;">מרחק: ${store.distance.toFixed(1)} ק"מ</span>
          </div>
        `, { closeButton: false })
        .addTo(map);

      nearbyStoreMarkers.push(marker);
    });

    if (nearby.length > 0) {
      const coords = [[currentLocation.lat, currentLocation.lon], ...nearby.map(s => [s.latitude, s.longitude])];
      map.fitBounds(L.latLngBounds(coords), { padding: [40, 40] });
    }
  }

  // ----- autocomplete -----

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

  productSearchInput.addEventListener('input', runSuggest);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-input-wrapper')) suggestDropdown.classList.remove('open');
  });

  // ----- sort toggle -----

  if (sortToggle) {
    sortToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sort]');
      if (!btn) return;
      currentSort = btn.dataset.sort;
      sortToggle.querySelectorAll('[data-sort]').forEach(b => b.classList.toggle('active', b === btn));
      const q = productSearchInput.value.trim();
      if (q) searchProducts(q);
    });
  }

  // ----- product search (server-side, cheapest-nearby-first) -----

  async function searchProducts(query) {
    try {
      runSuggest.cancel(); // a pending debounced suggest must not reopen over results
      suggestDropdown.classList.remove('open');
      searchResults.innerHTML = '<div class="loading-placeholder">מחפש מוצרים במאגר...</div>';

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
      if (data.count === 0) {
        searchResults.innerHTML = `<div class="loading-placeholder">${data.message || 'לא נמצאו מוצרים תואמים בסניפים שברדיוס הנבחר'}</div>`;
        return;
      }

      renderProducts(data.data);
    } catch (err) {
      console.error(err);
      searchResults.innerHTML = '<div class="loading-placeholder">שגיאה בביצוע החיפוש</div>';
    }
  }

  function renderProducts(productList) {
    searchResults.innerHTML = '';

    productList.forEach(prod => {
      const card = document.createElement('div');
      card.className = 'product-card';

      const chainColor = getChainColor(prod.best_store_chain_id);
      const hasPromo = !!prod.is_promo;
      const distance = prod.best_store_distance_km != null
        ? `· ${prod.best_store_distance_km.toFixed(1)} ק"מ` : '';
      const rangeText = prod.store_count > 1
        ? `₪${prod.best_price.toFixed(2)}–₪${prod.max_price.toFixed(2)} ב-${prod.store_count} סניפים`
        : 'סניף אחד ברדיוס';

      card.innerHTML = `
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
          </div>
          <div class="best-store-row">
            <span class="chain-dot" style="background: ${chainColor};"></span>
            <span class="best-store-text"></span>
          </div>
          ${hasPromo && prod.promo_description ? `<div class="promo-desc-row"></div>` : ''}
          <div class="price-meta-row">
            <span class="range-text">${rangeText}</span>
            <span class="unit-text">₪${(prod.best_unit_price ?? 0).toFixed(2)} ל-100 ${prod.unit_of_measure || 'יח׳'}</span>
          </div>
        </div>

        <div class="card-actions">
          <button class="btn-add-cart">
            <i data-lucide="plus" style="width: 14px; height: 14px;"></i>
            הוסף לעגלה
          </button>
          <button class="btn-compare">
            <i data-lucide="bar-chart-3" style="width: 14px; height: 14px;"></i>
            השוואת סניפים
          </button>
        </div>
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
        const promoRow = card.querySelector('.promo-desc-row');
        promoRow.textContent = prod.promo_description +
          (prod.promo_end ? ` (עד ${prod.promo_end.slice(0, 10)})` : '');
      }

      card.querySelector('.btn-add-cart').addEventListener('click', () => addToCart(prod));
      card.querySelector('.btn-compare').addEventListener('click', () =>
        toggleCompare(card, prod));

      searchResults.appendChild(card);
    });

    lucide.createIcons();
  }

  // Lazy per-product branch comparison via the batch endpoint.
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
      const res = await fetch('/api/v1/prices/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barcodes: [prod.barcode],
          store_ids: nearby.slice(0, 600).map(s => s.id)
        })
      });
      const data = await res.json();
      if (!data.success || !data.data.length) {
        list.innerHTML = '<div class="loading-placeholder" style="padding:8px;">אין מחירים זמינים</div>';
        return;
      }
      const rows = data.data.sort((a, b) => a.effective_price - b.effective_price);
      list.innerHTML = '';
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

  // ----- shopping cart (persisted) -----

  function loadCart() {
    try {
      const raw = localStorage.getItem(CART_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function saveCart() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch (err) { /* storage full/blocked — cart stays in memory */ }
  }

  function addToCart(product) {
    const existing = cart.find(item => item.barcode === product.barcode);
    if (existing) {
      existing.qty += 1;
    } else {
      cart.push({ barcode: product.barcode, name: product.name, qty: 1 });
    }
    saveCart();
    renderCart();
  }

  function renderCart() {
    cartList.innerHTML = '';
    if (cart.length === 0) {
      emptyCartMsg.style.display = 'block';
      return;
    }
    emptyCartMsg.style.display = 'none';

    cart.forEach(item => {
      const li = document.createElement('li');
      li.className = 'cart-item';
      li.innerHTML = `
        <span class="cart-item-name"></span>
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

    lucide.createIcons();
  }

  function updateCartQty(barcode, change) {
    const item = cart.find(i => i.barcode === barcode);
    if (item) {
      item.qty += change;
      if (item.qty <= 0) {
        removeFromCart(barcode);
      } else {
        saveCart();
        renderCart();
      }
    }
  }

  function removeFromCart(barcode) {
    cart = cart.filter(i => i.barcode !== barcode);
    saveCart();
    renderCart();
  }

  // ----- distance slider -----

  const debouncedMapRender = debounce(renderAllNearbyStoresOnMap, 250);
  maxDistanceSlider.addEventListener('input', () => {
    distanceValSpan.innerText = `${maxDistanceSlider.value} ק"מ`;
    debouncedMapRender();
  });

  maxDistanceSlider.addEventListener('change', () => {
    const q = productSearchInput.value.trim();
    if (q) searchProducts(q);
  });

  // ----- route drawing -----

  function drawRouteOnMap(route, userLoc) {
    routeLines.forEach(l => map.removeLayer(l));
    mapStoreMarkers.forEach(m => map.removeLayer(m));
    routeLines = [];
    mapStoreMarkers = [];

    if (!route || route.length === 0) return;

    const coords = [[userLoc.lat, userLoc.lon]];

    route.forEach((store, idx) => {
      coords.push([store.latitude, store.longitude]);

      const storeColor = getChainColor(store.chain_id);
      const storeIcon = L.divIcon({
        className: 'map-store-pin',
        html: `<div style="background: ${storeColor}; width: 12px; height: 12px; border: 2px solid white; border-radius: 4px; box-shadow: 0 0 10px ${storeColor};"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      });

      const itemsBought = currentOptimalPurchases[store.id] || [];
      const itemsListStr = itemsBought.map(i => `${i.name} (x${i.qty})`).join('<br>');

      const marker = L.marker([store.latitude, store.longitude], { icon: storeIcon })
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
    map.fitBounds(L.latLngBounds(coords), { padding: [30, 30] });
    if (mapStoreMarkers.length > 0) mapStoreMarkers[0].openPopup();
  }

  let currentOptimalPurchases = {};

  // ----- basket optimization -----
  // One batch call for the whole cart, then exhaustive 1/2/3-store combos over
  // a candidate pool (union of each item's cheapest stores, capped) so the
  // search stays fast with 14 chains' worth of nearby branches.

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
      // 1. One batch price call: every cart item × every nearby store.
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

      // barcode -> store_id -> effective price record
      const priceMap = new Map();
      payload.data.forEach(rec => {
        if (!priceMap.has(rec.barcode)) priceMap.set(rec.barcode, new Map());
        priceMap.get(rec.barcode).set(rec.store_id, rec);
      });

      // 2. Candidate pool: the 8 cheapest stores per item, capped at 25 total.
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
      if (pool.length > 25) pool = pool.slice(0, 25); // nearStores is distance-sorted

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

      // 3. Pairwise distance matrix, computed once.
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

      let bestSingle = null;
      pool.forEach(s => {
        const option = evaluateStoreSet([s], 'single');
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

      // Render route cards
      routesContainer.innerHTML = '';

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
          drawRouteOnMap(opt.route, userLoc);
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

  // Init
  Promise.all([loadChains(), loadStores()]).then(() => {
    renderCart();
    searchProducts(productSearchInput.value.trim() || 'קוטג');
  });
  initMap();
});
