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
  
  // Coordinate dictionary
  const locationCoordinates = {
    tel_aviv: { lat: 32.0800, lon: 34.7800, name: 'תל אביב' },
    jerusalem: { lat: 31.7680, lon: 35.2100, name: 'ירושלים' },
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
      }
    } catch (err) {
      console.error('Failed to load stores:', err);
    }
  }

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

  // Product Search with Unit Price Sorting
  async function searchProducts(query) {
    try {
      searchResults.innerHTML = '<div class="loading-placeholder">מחפש מוצרים במאגר...</div>';
      
      const res = await fetch(`/api/v1/products?query=${encodeURIComponent(query)}`);
      const data = await res.json();
      
      if (!data.success || data.count === 0) {
        searchResults.innerHTML = '<div class="loading-placeholder">לא נמצאו מוצרים תואמים</div>';
        return;
      }

      // Fetch prices for all matched products in parallel to calculate sorting metrics
      const productList = data.data;
      const pricePromises = productList.map(p => 
        fetch(`/api/v1/prices?barcode=${p.barcode}`).then(r => r.json())
      );
      
      const priceResults = await Promise.all(pricePromises);
      
      // Enrich each product with price statistics
      const enrichedProducts = productList.map((prod, idx) => {
        const pricesPayload = priceResults[idx];
        const storePrices = pricesPayload.success ? pricesPayload.data : [];
        
        let minUnitPrice = Infinity;
        let cheapestRecord = null;
        
        storePrices.forEach(priceRec => {
          if (priceRec.unit_price < minUnitPrice) {
            minUnitPrice = priceRec.unit_price;
            cheapestRecord = priceRec;
          }
        });
        
        return {
          ...prod,
          cheapestPriceRecord: cheapestRecord,
          minUnitPrice: minUnitPrice === Infinity ? 999999 : minUnitPrice // Fallback high price if no pricing available
        };
      });

      // Sort products by cheapest unit price (cheapest per 100 grams/units first)
      enrichedProducts.sort((a, b) => a.minUnitPrice - b.minUnitPrice);

      renderProducts(enrichedProducts);

    } catch (err) {
      console.error(err);
      searchResults.innerHTML = '<div class="loading-placeholder">שגיאה בטעינת תוצאות החיפוש</div>';
    }
  }

  function renderProducts(productList) {
    searchResults.innerHTML = '';
    
    productList.forEach(prod => {
      const card = document.createElement('div');
      card.className = 'product-card';
      
      // Format pricing block
      let pricingHtml = '';
      if (prod.cheapestPriceRecord) {
        pricingHtml = `
          <div class="product-pricing-box">
            <div class="unit-price-badge">
              <span class="label">מחיר ל-100 ${prod.unit_of_measure}:</span>
              <span class="value">₪${prod.minUnitPrice.toFixed(2)}</span>
            </div>
            <div class="cheapest-store-row">
              <span class="store-name">${prod.cheapestPriceRecord.chain_name} (${prod.cheapestPriceRecord.store_name})</span>
              <span class="price">₪${prod.cheapestPriceRecord.price.toFixed(2)}</span>
            </div>
          </div>
        `;
      } else {
        pricingHtml = `
          <div class="product-pricing-box" style="text-align: center; color: var(--text-muted); font-size: 11px;">
            אין מחיר זמין כרגע ברשתות
          </div>
        `;
      }

      card.innerHTML = `
        <div class="product-meta">
          <span class="product-brand-tag">${prod.brand} | ${prod.manufacturer}</span>
          <h4 class="product-title">${prod.name}</h4>
          <span class="product-weight">גודל: ${prod.unit_qty} ${prod.unit_of_measure} | ברקוד: ${prod.barcode}</span>
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
      const userLoc = locationCoordinates[locKey];
      const maxDistLimit = parseFloat(maxDistanceSlider.value);

      // 3. Filter stores within driving radius limit
      const nearStores = allStores.map(store => {
        const dist = calculateDistance(userLoc.lat, userLoc.lon, store.latitude, store.longitude);
        return { ...store, distance: dist };
      }).filter(store => store.distance <= maxDistLimit);

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
                <span class="route-step-dist">${store.distance.toFixed(1)} ק"מ מהבית</span>
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
              <span style="font-size:10px; color:var(--text-muted);">(עלות דלק: ₪${opt.travelCost.toFixed(2)})</span>
            </div>
            <div class="total-price-label">
              מחיר סל כולל: 
              <span class="total-price-val">₪${opt.totalCost.toFixed(2)}</span>
            </div>
          </div>
        `;

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
  searchProducts('קוטג');
});
