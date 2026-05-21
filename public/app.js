document.addEventListener('DOMContentLoaded', () => {
  // Init Lucide Icons
  lucide.createIcons();

  // DOM Elements
  const scrapersContainer = document.getElementById('scrapers-container');
  const productSearchInput = document.getElementById('product-search');
  const searchBtn = document.getElementById('search-btn');
  const searchResults = document.getElementById('search-results');
  const comparisonBox = document.getElementById('comparison-box');
  const compProductName = document.getElementById('comp-product-name');
  const compProductBarcode = document.getElementById('comp-product-barcode');
  const comparisonBody = document.getElementById('comparison-body');
  
  const apiEndpointSelector = document.getElementById('api-endpoint-selector');
  const paramsContainer = document.getElementById('params-container');
  const sendApiBtn = document.getElementById('send-api-btn');
  const resStatus = document.getElementById('res-status');
  const responseOutput = document.getElementById('response-output');
  const copyResponseBtn = document.getElementById('copy-response');
  
  const tabBtns = document.querySelectorAll('.tab-btn');
  const snippets = document.querySelectorAll('.snippet-pre');

  // State Variables
  let currentProductBarcode = '';
  let pollingIntervals = {};

  // Scraper status fetcher
  async function fetchScrapers() {
    try {
      const res = await fetch('/api/v1/scraper-status');
      const data = await res.json();
      if (data.success) {
        renderScrapers(data.data);
      }
    } catch (err) {
      console.error('Error fetching scrapers:', err);
    }
  }

  function renderScrapers(statusMap) {
    scrapersContainer.innerHTML = '';
    let activeUpdates = 0;
    let totalSize = 0;
    
    Object.keys(statusMap).forEach(chainId => {
      const chain = statusMap[chainId];
      const displayName = getChainNameHebrew(chainId);
      activeUpdates += chain.files_downloaded * 23010;
      totalSize += chain.size_mb;

      const isRunning = chain.status === 'running';
      const isError = chain.status === 'error';
      
      let badgeClass = 'idle';
      let badgeText = 'מוכן';
      
      if (isRunning) {
        badgeClass = 'running';
        badgeText = 'בפעולה';
      } else if (isError) {
        badgeClass = 'error';
        badgeText = 'שגיאה';
      }

      const row = document.createElement('div');
      row.className = 'scraper-row';
      row.innerHTML = `
        <div class="scraper-logo-group">
          <div class="logo-icon-small" style="width: 8px; height: 32px; background: ${getChainColor(chainId)}; border-radius: 4px;"></div>
          <div class="scraper-name">${displayName}</div>
        </div>
        
        <div class="scraper-stats-row">
          <div class="stat-item">
            <span class="stat-label">סנכרון אחרון</span>
            <span class="stat-val">${formatTime(chain.last_run)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">קבצים</span>
            <span class="stat-val">${chain.files_downloaded}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">נפח</span>
            <span class="stat-val">${chain.size_mb.toFixed(1)} MB</span>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 12px;">
          <span class="status-badge ${badgeClass}">
            ${isRunning ? '<span class="spinner"></span>' : ''}
            ${badgeText}
          </span>
          <button class="btn-trigger" data-chain="${chainId}" ${isRunning ? 'disabled' : ''}>
            <i data-lucide="play" style="width:12px; height:12px;"></i>
            הפעל
          </button>
        </div>
      `;
      
      const triggerBtn = row.querySelector('.btn-trigger');
      triggerBtn.addEventListener('click', () => triggerScrape(chainId));
      scrapersContainer.appendChild(row);
    });

    lucide.createIcons();
    document.getElementById('metric-size').innerText = `${(totalSize / 1024).toFixed(2)} GB`;
    if (activeUpdates > 0) {
      document.getElementById('metric-updates').innerText = activeUpdates.toLocaleString();
    }
  }

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

  function formatTime(isoStr) {
    if (!isoStr) return 'לעולם לא';
    if (isoStr.startsWith('Running')) return 'כעת';
    const date = new Date(isoStr);
    if (isNaN(date.getTime())) return isoStr;
    return date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) + ' ' + date.toLocaleDateString('he-IL', { month: '2-digit', day: '2-digit' });
  }

  async function triggerScrape(chainId) {
    try {
      const response = await fetch('/api/v1/trigger-scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain_id: chainId })
      });
      const data = await response.json();
      if (data.success) {
        fetchScrapers();
        if (pollingIntervals[chainId]) clearInterval(pollingIntervals[chainId]);
        pollingIntervals[chainId] = setInterval(async () => {
          const res = await fetch('/api/v1/scraper-status');
          const statusData = await res.json();
          if (statusData.success) {
            const chainStatus = statusData.data[chainId];
            renderScrapers(statusData.data);
            if (chainStatus.status !== 'running') {
              clearInterval(pollingIntervals[chainId]);
              delete pollingIntervals[chainId];
            }
          }
        }, 1500);
      }
    } catch (err) {
      console.error('Error triggering scraper:', err);
    }
  }

  // Product Explorer Search
  async function searchProducts(query) {
    try {
      searchResults.innerHTML = '<div class="loading-placeholder">מחפש במאגר...</div>';
      const res = await fetch(`/api/v1/products?query=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.success) {
        renderProducts(data.data);
      }
    } catch (err) {
      searchResults.innerHTML = '<div class="loading-placeholder">שגיאה בביצוע החיפוש</div>';
    }
  }

  function renderProducts(productList) {
    searchResults.innerHTML = '';
    if (productList.length === 0) {
      searchResults.innerHTML = '<div class="loading-placeholder">לא נמצאו מוצרים תואמים</div>';
      comparisonBox.classList.add('hidden');
      return;
    }

    productList.forEach(prod => {
      const card = document.createElement('div');
      card.className = `product-card ${prod.barcode === currentProductBarcode ? 'active' : ''}`;
      card.innerHTML = `
        <div>
          <div class="product-name">${prod.name}</div>
          <div class="product-brand">${prod.brand} | ${prod.manufacturer}</div>
        </div>
        <div class="product-barcode">ברקוד: ${prod.barcode}</div>
      `;
      card.addEventListener('click', () => {
        document.querySelectorAll('.product-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        showPriceComparison(prod);
      });
      searchResults.appendChild(card);
    });

    if (productList.length > 0 && !currentProductBarcode) {
      searchResults.children[0].click();
    }
  }

  async function showPriceComparison(product) {
    currentProductBarcode = product.barcode;
    compProductName.innerText = product.name;
    compProductBarcode.innerText = `ברקוד: ${product.barcode}`;
    
    try {
      comparisonBody.innerHTML = '<tr><td colspan="5" style="text-align: center;">טוען מחירים...</td></tr>';
      comparisonBox.classList.remove('hidden');
      
      const res = await fetch(`/api/v1/prices?barcode=${product.barcode}`);
      const data = await res.json();
      
      if (data.success && data.count > 0) {
        comparisonBody.innerHTML = '';
        data.data.forEach(price => {
          const row = document.createElement('tr');
          row.innerHTML = `
            <td>
              <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 6px; height: 20px; background: ${getChainColor(price.store_id.split('_')[0] + '_' + price.store_id.split('_')[1]) || getChainColor(price.store_id.split('_')[0])}; border-radius: 2px;"></div>
                ${price.chain_name}
              </div>
            </td>
            <td>${price.store_name}</td>
            <td><span class="price-tag">₪${price.price.toFixed(2)}</span></td>
            <td>₪${price.unit_price.toFixed(2)} ל-100 ${product.unit_of_measure}</td>
            <td>${formatTime(price.last_updated)}</td>
          `;
          comparisonBody.appendChild(row);
        });
      } else {
        comparisonBody.innerHTML = '<tr><td colspan="5" style="text-align: center;">לא נמצאו מחירים למוצר זה ברשתות כרגע.</td></tr>';
      }
    } catch (err) {
      comparisonBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--accent-red);">שגיאה בטעינת נתונים</td></tr>';
    }
  }

  searchBtn.addEventListener('click', () => {
    const q = productSearchInput.value.trim();
    if (q) searchProducts(q);
  });

  productSearchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      searchBtn.click();
    }
  });

  // API Playground Parameters Mapping
  const endpointParams = {
    '/api/v1/chains': [],
    '/api/v1/stores': [
      { name: 'chain_id', placeholder: 'e.g. shufersal (סינון לפי רשת)', type: 'text' }
    ],
    '/api/v1/products': [
      { name: 'query', placeholder: 'e.g. קוטג\' (חיפוש טקסט חופשי)', type: 'text' },
      { name: 'barcode', placeholder: 'e.g. 7290000042420 (ברקוד מדויק)', type: 'text' }
    ],
    '/api/v1/prices': [
      { name: 'barcode', placeholder: 'e.g. 7290000042420 (ברקוד)', type: 'text' },
      { name: 'store_id', placeholder: 'e.g. shufersal_123 (מזהה סניף)', type: 'text' }
    ],
    '/api/v1/scraper-status': []
  };

  function updatePlaygroundParams() {
    const endpoint = apiEndpointSelector.value;
    const params = endpointParams[endpoint] || [];
    paramsContainer.innerHTML = '';
    
    if (params.length === 0) {
      paramsContainer.innerHTML = '<span style="font-size:12px; color:var(--text-muted);">אין פרמטרים לנתיב זה.</span>';
      return;
    }
    
    params.forEach(param => {
      const row = document.createElement('div');
      row.className = 'param-input-group';
      row.innerHTML = `
        <label>${param.name}:</label>
        <input type="text" data-param="${param.name}" placeholder="${param.placeholder}">
      `;
      paramsContainer.appendChild(row);
    });
  }

  apiEndpointSelector.addEventListener('change', updatePlaygroundParams);

  sendApiBtn.addEventListener('click', async () => {
    const endpoint = apiEndpointSelector.value;
    const inputs = paramsContainer.querySelectorAll('input');
    const urlParams = new URLSearchParams();
    
    inputs.forEach(input => {
      const val = input.value.trim();
      if (val) {
        urlParams.append(input.dataset.param, val);
      }
    });

    const paramStr = urlParams.toString();
    const fullUrl = `${endpoint}${paramStr ? '?' + paramStr : ''}`;
    
    try {
      responseOutput.innerText = 'מבצע קריאה...';
      resStatus.innerText = 'WAITING';
      resStatus.className = 'status-code';
      
      const res = await fetch(fullUrl);
      resStatus.innerText = `${res.status} ${res.statusText}`;
      resStatus.className = `status-code ${res.ok ? 'success' : 'error'}`;
      
      const data = await res.json();
      responseOutput.innerText = JSON.stringify(data, null, 2);
    } catch (err) {
      resStatus.innerText = 'ERROR';
      resStatus.className = 'status-code error';
      responseOutput.innerText = `Network Error:\n${err.message}`;
    }
  });

  // Code snippets tab selection
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      snippets.forEach(s => s.classList.remove('active'));
      
      btn.classList.add('active');
      const lang = btn.dataset.lang;
      document.getElementById(`snippet-${lang}`).classList.add('active');
    });
  });

  // Copy API Response
  copyResponseBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(responseOutput.innerText)
      .then(() => {
        const originalIcon = copyResponseBtn.innerHTML;
        copyResponseBtn.innerHTML = '<i data-lucide="check" style="color:var(--accent-green)"></i>';
        lucide.createIcons();
        setTimeout(() => {
          copyResponseBtn.innerHTML = originalIcon;
          lucide.createIcons();
        }, 1500);
      });
  });

  // Init
  fetchScrapers();
  searchProducts('קוטג');
  updatePlaygroundParams();
});
