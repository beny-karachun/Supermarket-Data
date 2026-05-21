document.addEventListener('DOMContentLoaded', () => {
  // Init Lucide Icons
  lucide.createIcons();

  // DOM Elements
  const productSearchInput = document.getElementById('product-search');
  const searchBtn = document.getElementById('search-btn');
  const searchResults = document.getElementById('search-results');
  
  const cartList = document.getElementById('cart-list');
  const emptyCartMsg = document.getElementById('empty-cart-msg');
  const userLocationSelect = document.getElementById('user-location');
  const maxDistanceSlider = document.getElementById('max-distance');
  const distanceValSpan = document.getElementById('distance-val');
  const optimizeBtn = document.getElementById('optimize-btn');
  const routesContainer = document.getElementById('routes-container');

  // State Variables
  let cart = []; // Array of { barcode, name, qty }
  let allStores = []; // Store catalog loaded from server
  
  // Leaflet Map State
  let map;
  let userMarker;
  let routeLines = [];
  let mapStoreMarkers = [];
  let nearbyStoreMarkers = [];

  // Coordinate dictionary
  const locationCoordinates = {
    jerusalem: { lat: 31.7680, lon: 35.2100, name: 'ירושלים' },
    tel_aviv: { lat: 32.0800, lon: 34.7800, name: 'תל אביב' },
    rehovot: { lat: 31.9000, lon: 34.8100, name: 'רחובות' },
    haifa: { lat: 32.8000, lon: 35.0000, name: 'חיפה' }
  };

  // Load stores from server on startup
  async function loadStores() {
    try {
      const res = await fetch('/api/v1/stores');
      const data = await res.json();
      if (data.success) {
        allStores = data.data;
        renderAllNearbyStoresOnMap();
      }
    } catch (err) {
      console.error('Failed to load stores:', err);
    }
  }

  // Initialize Interactive Map
  function initMap() {
    const defaultCoords = locationCoordinates.jerusalem;
    
    // Create Leaflet Map (disable zoom controls to fit compact UI)
    map = L.map('shopper-map', {
      zoomControl: true,
      attributionControl: false
    }).setView([defaultCoords.lat, defaultCoords.lon], 12);

    // Use dark mode theme tiles (matches dashboard style)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(map);

    // Home location icon style
    const homeIcon = L.divIcon({
      className: 'map-home-pin',
      html: `<div style="background: var(--accent-cyan); width: 14px; height: 14px; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 12px var(--accent-cyan);"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });

    userMarker = L.marker([defaultCoords.lat, defaultCoords.lon], { icon: homeIcon }).addTo(map);

    // Map click handler: updates home position
    map.on('click', (e) => {
      const { lat, lng } = e.latlng;
      updateStartLocation(lat, lng, true);
    });
  }

  // Sync selector/map interactions
  function updateStartLocation(lat, lng, isFromMapClick = false) {
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
      locationCoordinates.custom = { lat, lon: lng, name: 'מיקום מפה מותאם' };
    } else {
      map.setView([lat, lng], 12);
    }

    renderAllNearbyStoresOnMap();

    // Re-trigger product search if search input has value to update shown results and prices
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
      // Free open-source Nominatim geocoding engine (supports Hebrew queries)
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
      const data = await res.json();
      
      if (data && data.length > 0) {
        const found = data[0];
        const lat = parseFloat(found.lat);
        const lon = parseFloat(found.lon);
        
        // Update user start position
        updateStartLocation(lat, lon, true);
        map.setView([lat, lon], 14); // Zoom in closer for specific address
        
        // Visual feedback
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

  // GPS Geolocation Detector
  gpsLocationBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('דפדפן זה אינו תומך בזיהוי מיקום GPS.');
      return;
    }

    gpsLocationBtn.innerHTML = '<span class="spinner" style="width:12px; height:12px; border-color:var(--accent-cyan); border-top-color:transparent;"></span> מזהה...';
    gpsLocationBtn.disabled = true;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        
        updateStartLocation(lat, lon, true);
        map.setView([lat, lon], 14);

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
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Get stores within distance limit from user starting coordinates
  function getNearbyStores() {
    const locKey = userLocationSelect.value;
    const userLoc = locationCoordinates[locKey] || locationCoordinates.custom || locationCoordinates.jerusalem;
    const maxDistLimit = parseFloat(maxDistanceSlider.value);
    
    return allStores.map(store => {
      const dist = calculateDistance(userLoc.lat, userLoc.lon, store.latitude, store.longitude);
      return { ...store, distance: dist };
    }).filter(store => store.distance <= maxDistLimit);
  }

  // Draw all supermarkets within radius on map immediately
  function renderAllNearbyStoresOnMap() {
    // Clear previous store markers (but keep user start marker)
    nearbyStoreMarkers.forEach(m => map.removeLayer(m));
    nearbyStoreMarkers = [];
    
    // Clear route layers since user configuration changed
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

    // Auto fit map bounds to contain user home and all stores within radius
    if (nearby.length > 0) {
      const locKey = userLocationSelect.value;
      const userLoc = locationCoordinates[locKey] || locationCoordinates.custom || locationCoordinates.jerusalem;
      const coords = [[userLoc.lat, userLoc.lon], ...nearby.map(s => [s.latitude, s.longitude])];
      map.fitBounds(L.latLngBounds(coords), { padding: [40, 40] });
    }
  }

  // Product Search with Scoped Unit Price Sorting
  async function searchProducts(query) {
    try {
      searchResults.innerHTML = '<div class="loading-placeholder">מחפש מוצרים במאגר...</div>';
      
      const res = await fetch(`/api/v1/products?query=${encodeURIComponent(query)}`);
      const data = await res.json();
      
      if (!data.success || data.count === 0) {
        searchResults.innerHTML = '<div class="loading-placeholder">לא נמצאו מוצרים תואמים</div>';
        return;
      }

      // Fetch prices for all matched products in parallel
      const productList = data.data;
      const pricePromises = productList.map(p => 
        fetch(`/api/v1/prices?barcode=${p.barcode}`).then(r => r.json())
      );
      
      const priceResults = await Promise.all(pricePromises);
      
      // Get nearby stores to scope results
      const nearbyStores = getNearbyStores();
      const nearbyStoreIds = new Set(nearbyStores.map(s => s.id));
      
      // Enrich each product with price statistics in nearby stores only
      const enrichedProducts = productList.map((prod, idx) => {
        const pricesPayload = priceResults[idx];
        const storePrices = pricesPayload.success ? pricesPayload.data : [];
        
        // Only include prices from stores within selected driving distance
        const localPrices = storePrices.filter(priceRec => nearbyStoreIds.has(priceRec.store_id));
        
        // Enrich prices with distance coordinates and sort cheapest first
        const localPricesEnriched = localPrices.map(priceRec => {
          const storeObj = nearbyStores.find(s => s.id === priceRec.store_id);
          return {
            ...priceRec,
            distance: storeObj ? storeObj.distance : 999
          };
        });

        localPricesEnriched.sort((a, b) => a.price - b.price);
        
        const cheapestRecord = localPricesEnriched[0] || null;
        
        return {
          ...prod,
          cheapestPriceRecord: cheapestRecord,
          minUnitPrice: cheapestRecord ? cheapestRecord.unit_price : 999999,
          allLocalPrices: localPricesEnriched
        };
      }).filter(prod => prod.cheapestPriceRecord !== null); // ONLY show products in those branches

      if (enrichedProducts.length === 0) {
        searchResults.innerHTML = '<div class="loading-placeholder">אין מוצרים זמינים בסניפים שברדיוס הנבחר</div>';
        return;
      }

      // Sort products by cheapest unit price (cheapest per 100 grams/units first)
      enrichedProducts.sort((a, b) => a.minUnitPrice - b.minUnitPrice);

      renderProducts(enrichedProducts);

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
      
      // Format pricing block
      let pricingHtml = '';
      if (prod.allLocalPrices && prod.allLocalPrices.length > 0) {
        const pricesListHtml = prod.allLocalPrices.map((p, idx) => {
          const isCheapest = idx === 0;
          const chainColor = getChainColor(p.store_id.split('_')[0]);
          return `
            <div class="store-price-row ${isCheapest ? 'cheapest-row' : ''}">
              <div class="store-info-col">
                <span class="chain-dot" style="background: ${chainColor};"></span>
                <span class="store-name-text">${p.chain_name} (${p.store_name})</span>
                <span class="store-dist-text">(${p.distance.toFixed(1)} ק"מ)</span>
              </div>
              <div class="price-col">
                ${isCheapest ? '<span class="cheapest-tag">הכי זול</span>' : ''}
                <span class="price-val">₪${p.price.toFixed(2)}</span>
              </div>
            </div>
          `;
        }).join('');

        pricingHtml = `
          <div class="product-pricing-box">
            <div class="unit-price-badge">
              <span class="label">מחיר ל-100 ${prod.unit_of_measure || 'יחידה'}:</span>
              <span class="value">₪${prod.minUnitPrice.toFixed(2)}</span>
            </div>
            <div class="store-prices-list">
              ${pricesListHtml}
            </div>
          </div>
        `;
      } else {
        pricingHtml = `
          <div class="product-pricing-box" style="text-align: center; color: var(--text-muted); font-size: 11px;">
            אין מחיר זמין בסניפים הקרובים
          </div>
        `;
      }

      card.innerHTML = `
        <div class="product-meta">
          <span class="product-brand-tag">${prod.brand} | ${prod.manufacturer}</span>
          <h4 class="product-title">${prod.name}</h4>
          <span class="product-weight">גודל: ${prod.unit_qty} ${prod.unit_of_measure || 'יחידה'} | ברקוד: ${prod.barcode}</span>
        </div>
        
        ${pricingHtml}
        
        <button class="btn-add-cart" data-barcode="${prod.barcode}">
          <i data-lucide="plus" style="width: 14px; height: 14px;"></i>
          הוסף לעגלת הקניות
        </button>
      `;

      card.querySelector('.btn-add-cart').addEventListener('click', () => {
        addToCart(prod);
      });

      searchResults.appendChild(card);
    });

    lucide.createIcons();
  }

  // Shopping Cart Operations
  function addToCart(product) {
    const existing = cart.find(item => item.barcode === product.barcode);
    if (existing) {
      existing.qty += 1;
    } else {
      cart.push({
        barcode: product.barcode,
        name: product.name,
        qty: 1
      });
    }
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
        <span class="cart-item-name">${item.name}</span>
        <div class="cart-item-actions">
          <button class="cart-qty-btn minus">-</button>
          <span class="cart-item-qty">${item.qty}</span>
          <button class="cart-qty-btn plus">+</button>
          <button class="cart-remove-btn">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
          </button>
        </div>
      `;

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
        renderCart();
      }
    }
  }

  function removeFromCart(barcode) {
    cart = cart.filter(i => i.barcode !== barcode);
    renderCart();
  }

  // Slider events
  maxDistanceSlider.addEventListener('input', () => {
    distanceValSpan.innerText = `${maxDistanceSlider.value} ק"מ`;
    renderAllNearbyStoresOnMap();
  });

  maxDistanceSlider.addEventListener('change', () => {
    const q = productSearchInput.value.trim();
    if (q) searchProducts(q);
  });

  function getChainNameHebrew(id) {
    const names = {
      shufersal: 'שופרסל',
      rami_levy: 'רמי לוי',
      yohananof: 'יוחננוף',
      victory: 'ויקטורי',
      tiv_taam: 'טיב טעם'
    };
    return names[id] || id;
  }

  function getChainColor(id) {
    const colors = {
      shufersal: '#ef4444',
      rami_levy: '#f59e0b',
      yohananof: '#8b5cf6',
      victory: '#06b6d4',
      tiv_taam: '#10b981'
    };
    return colors[id] || '#ffffff';
  }

  // Draw optimized route on Leaflet map
  function drawRouteOnMap(route, userLoc) {
    // Clear existing route layers
    routeLines.forEach(l => map.removeLayer(l));
    mapStoreMarkers.forEach(m => map.removeLayer(m));
    routeLines = [];
    mapStoreMarkers = [];

    if (!route || route.length === 0) return;

    // Compile coordinate array: Home -> Store 1 -> Store 2 -> Home
    const coords = [[userLoc.lat, userLoc.lon]];
    
    route.forEach((store, idx) => {
      coords.push([store.latitude, store.longitude]);

      // Add a custom marker for the store
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

    // Draw the polyline routing loop
    const polyline = L.polyline(coords, {
      color: 'var(--accent-cyan)',
      weight: 3,
      opacity: 0.7,
      dashArray: '5, 8'
    }).addTo(map);

    routeLines.push(polyline);

    // Fit map bounds to contain user home and all stores
    const bounds = L.latLngBounds(coords);
    map.fitBounds(bounds, { padding: [30, 30] });

    // Open first store popup for clarity
    if (mapStoreMarkers.length > 0) {
      mapStoreMarkers[0].openPopup();
    }
  }

  let currentOptimalPurchases = {}; // Global reference for map popups

  // Smart Cart Routing Optimization Algorithm
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

    // 1. Fetch prices for all items in the cart in parallel
    const pricePromises = cart.map(item => fetch(`/api/v1/prices?barcode=${item.barcode}`).then(res => res.json()));
    
    try {
      const priceResults = await Promise.all(pricePromises);
      const barcodePricesMap = {};
      
      cart.forEach((item, idx) => {
        const res = priceResults[idx];
        barcodePricesMap[item.barcode] = res.success ? res.data : [];
      });

      // 2. Identify selected user location coordinates
      const locKey = userLocationSelect.value;
      const userLoc = locationCoordinates[locKey] || locationCoordinates.custom || locationCoordinates.jerusalem;
      const maxDistLimit = parseFloat(maxDistanceSlider.value);

      // 3. Filter stores within driving radius limit
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

      // 4. Generate permutations and calculate routes
      const options = [];

      const DRIVING_COST_PER_KM = 1.5; 
      const OUT_OF_STOCK_PENALTY = 50.0;

      // Helper function to evaluate combinations
      function evaluateStoreSet(storeSet, type) {
        let totalItemsCost = 0;
        let missingItems = [];
        const purchaseListByStore = {};

        storeSet.forEach(s => purchaseListByStore[s.id] = []);

        // Distribute cart items to the cheapest available store in this set
        cart.forEach(cartItem => {
          let cheapestPrice = Infinity;
          let targetStoreId = null;

          storeSet.forEach(store => {
            const storePrices = barcodePricesMap[cartItem.barcode] || [];
            const itemPriceRecord = storePrices.find(p => p.store_id === store.id);
            if (itemPriceRecord && itemPriceRecord.price < cheapestPrice) {
              cheapestPrice = itemPriceRecord.price;
              targetStoreId = store.id;
            }
          });

          if (targetStoreId !== null) {
            const cost = cheapestPrice * cartItem.qty;
            totalItemsCost += cost;
            purchaseListByStore[targetStoreId].push({
              name: cartItem.name,
              qty: cartItem.qty,
              price: cheapestPrice,
              total: cost
            });
          } else {
            missingItems.push(cartItem.name);
            totalItemsCost += OUT_OF_STOCK_PENALTY * cartItem.qty;
          }
        });

        // Calculate optimal route sequence (TSP)
        let bestDistance = Infinity;
        let bestRouteSeq = [];

        if (storeSet.length === 1) {
          bestDistance = storeSet[0].distance * 2;
          bestRouteSeq = [storeSet[0]];
        } 
        else if (storeSet.length === 2) {
          const distBetweenStores = calculateDistance(storeSet[0].latitude, storeSet[0].longitude, storeSet[1].latitude, storeSet[1].longitude);
          bestDistance = storeSet[0].distance + distBetweenStores + storeSet[1].distance;
          bestRouteSeq = [storeSet[0], storeSet[1]];
        } 
        else if (storeSet.length === 3) {
          const permutations = [
            [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]
          ];
          permutations.forEach(p => {
            const s0 = storeSet[p[0]];
            const s1 = storeSet[p[1]];
            const s2 = storeSet[p[2]];
            const d1 = s0.distance;
            const d2 = calculateDistance(s0.latitude, s0.longitude, s1.latitude, s1.longitude);
            const d3 = calculateDistance(s1.latitude, s1.longitude, s2.latitude, s2.longitude);
            const d4 = s2.distance;
            const totalD = d1 + d2 + d3 + d4;
            if (totalD < bestDistance) {
              bestDistance = totalD;
              bestRouteSeq = [s0, s1, s2];
            }
          });
        }

        const travelCost = bestDistance * DRIVING_COST_PER_KM;
        const totalOverallCost = totalItemsCost + travelCost;

        return {
          type,
          storeSet,
          route: bestRouteSeq,
          totalDistance: bestDistance,
          totalItemCost: totalItemsCost - (missingItems.length * OUT_OF_STOCK_PENALTY),
          travelCost,
          totalCost: totalOverallCost,
          missingItems,
          purchases: purchaseListByStore
        };
      }

      // 4a. Find Cheapest Single Store Visit
      let bestSingle = null;
      nearStores.forEach(s => {
        const option = evaluateStoreSet([s], 'single');
        if (!bestSingle || option.totalCost < bestSingle.totalCost) {
          bestSingle = option;
        }
      });
      if (bestSingle) options.push(bestSingle);

      // 4b. Find Cheapest 2-Store Split
      if (nearStores.length >= 2) {
        let bestDouble = null;
        for (let i = 0; i < nearStores.length; i++) {
          for (let j = i + 1; j < nearStores.length; j++) {
            const option = evaluateStoreSet([nearStores[i], nearStores[j]], 'double');
            if (!bestDouble || option.totalCost < bestDouble.totalCost) {
              bestDouble = option;
            }
          }
        }
        if (bestDouble) options.push(bestDouble);
      }

      // 4c. Find Cheapest 3-Store Split
      if (nearStores.length >= 3) {
        let bestTriple = null;
        for (let i = 0; i < nearStores.length; i++) {
          for (let j = i + 1; j < nearStores.length; j++) {
            for (let k = j + 1; k < nearStores.length; k++) {
              const option = evaluateStoreSet([nearStores[i], nearStores[j], nearStores[k]], 'triple');
              if (!bestTriple || option.totalCost < bestTriple.totalCost) {
                bestTriple = option;
              }
            }
          }
        }
        if (bestTriple) options.push(bestTriple);
      }

      // 5. Sort options by total score (overall cheapest) and mark the winner
      if (options.length === 0) {
        routesContainer.innerHTML = '<div class="routing-placeholder-msg">שגיאה בחישוב המסלולים.</div>';
        return;
      }

      options.sort((a, b) => a.totalCost - b.totalCost);
      const cheapestOptionIndex = 0;

      // 6. Render Route Cards
      routesContainer.innerHTML = '';
      
      options.forEach((opt, idx) => {
        const isOverallCheapest = idx === cheapestOptionIndex;
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
        } else if (opt.type === 'triple') {
          typeTitle = 'פיצול ל-3 חנויות';
          typeBadge = 'double';
          cardBorderClass = 'double';
        }

        if (isOverallCheapest) {
          typeBadge = 'cheapest';
          cardBorderClass = 'cheapest';
        }

        card.className = `route-card ${cardBorderClass}`;
        
        // Build route steps markup
        let stepsHtml = '';
        opt.route.forEach((store, stepIdx) => {
          const itemsBought = opt.purchases[store.id] || [];
          let itemsListStr = itemsBought.map(i => `${i.name} (x${i.qty}) - ₪${(i.price * i.qty).toFixed(2)}`).join(', ');
          
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

        // Generate Google Maps multi-stop navigation URL
        const originCoords = `${userLoc.lat},${userLoc.lon}`;
        const destCoords = originCoords; // Loop back home
        const waypointsStr = opt.route.map(store => `${store.latitude},${store.longitude}`).join('|');
        const gmapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${originCoords}&destination=${destCoords}&waypoints=${encodeURIComponent(waypointsStr)}&travelmode=driving`;

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

        // Bind interactive events
        card.querySelector('.btn-draw-map').addEventListener('click', () => {
          currentOptimalPurchases = opt.purchases;
          drawRouteOnMap(opt.route, userLoc);
          
          // Add border highlight to active card
          document.querySelectorAll('.route-card').forEach(c => c.style.borderColor = 'var(--border-color)');
          card.style.borderColor = 'var(--accent-cyan)';
        });

        // Trigger mapping default for the cheapest option
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
  loadStores();
  initMap();
  searchProducts('קוטג');
});
