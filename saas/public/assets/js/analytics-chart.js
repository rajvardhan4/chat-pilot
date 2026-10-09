/**
 * Chat Pilot Analytics - Interactive SVG Usage & Token Graph
 * Pure Vanilla JS, dark glassmorphic styling, responsive with hover tooltips.
 */
(function () {
  'use strict';

  var dataEl = document.getElementById('cp-analytics-trend-data');
  var container = document.getElementById('cp-analytics-chart-container');
  var select = document.getElementById('cp-chart-metric-select');
  if (!dataEl || !container) return;

  var trendData = [];
  try {
    trendData = JSON.parse(dataEl.textContent || '[]');
  } catch (e) {
    trendData = [];
  }

  function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return Number(num).toLocaleString();
  }

  function getMetricValue(item, metric) {
    if (metric === 'tokens') return Number(item.tokens || 0);
    if (metric === 'conversations') return Number(item.conversations || 0);
    if (metric === 'leads') return Number(item.leads || 0);
    if (metric === 'ai_requests') return Number(item.aiRequests || 0);
    if (metric === 'cost') return Number(item.cost || 0);
    return Number(item.tokens || 0);
  }

  function renderChart() {
    container.innerHTML = '';
    var metric = select ? select.value : 'tokens';

    if (!trendData || !trendData.length) {
      container.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:100%; color:#94a3b8; font-size:0.9rem;">No trend data available for this range.</div>';
      return;
    }

    var rect = container.getBoundingClientRect();
    var width = rect.width || 700;
    var height = rect.height || 260;
    var padLeft = 55;
    var padRight = 25;
    var padTop = 25;
    var padBottom = 35;

    var chartW = width - padLeft - padRight;
    var chartH = height - padTop - padBottom;

    var maxVal = 0;
    trendData.forEach(function (d) {
      var v = getMetricValue(d, metric);
      if (v > maxVal) maxVal = v;
    });

    if (maxVal === 0) maxVal = (metric === 'cost' ? 0.01 : 5);

    var count = trendData.length;
    var stepX = count > 1 ? chartW / (count - 1) : chartW / 2;

    var points = trendData.map(function (d, i) {
      var v = getMetricValue(d, metric);
      var x = count > 1 ? padLeft + i * stepX : padLeft + chartW / 2;
      var y = padTop + chartH - (v / maxVal) * chartH;
      return {
        x: x,
        y: y,
        val: v,
        raw: d,
        date: d.date
      };
    });

    // Build SVG
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.style.overflow = 'visible';

    // Defs & Gradient
    var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    var grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    grad.setAttribute('id', 'cpAnalyticsGrad');
    grad.setAttribute('x1', '0');
    grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '0');
    grad.setAttribute('y2', '1');

    var stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', '#0678f9');
    stop1.setAttribute('stop-opacity', '0.45');
    grad.appendChild(stop1);

    var stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('stop-color', '#0678f9');
    stop2.setAttribute('stop-opacity', '0.0');
    grad.appendChild(stop2);
    defs.appendChild(grad);
    svg.appendChild(defs);

    // Horizontal Grid Lines & Y-axis Labels
    var gridRows = 4;
    for (var g = 0; g <= gridRows; g++) {
      var gy = padTop + (chartH / gridRows) * g;
      var gVal = maxVal - (maxVal / gridRows) * g;

      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', padLeft);
      line.setAttribute('y1', gy);
      line.setAttribute('x2', width - padRight);
      line.setAttribute('y2', gy);
      line.setAttribute('stroke', 'rgba(255, 255, 255, 0.07)');
      line.setAttribute('stroke-dasharray', '3 3');
      svg.appendChild(line);

      var txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', padLeft - 10);
      txt.setAttribute('y', gy + 4);
      txt.setAttribute('text-anchor', 'end');
      txt.setAttribute('fill', '#64748b');
      txt.setAttribute('font-size', '10px');
      txt.setAttribute('font-family', 'monospace');

      var labelText = (metric === 'cost') ? '$' + gVal.toFixed(gVal < 0.1 ? 3 : 2) : formatNumber(Math.round(gVal));
      txt.textContent = labelText;
      svg.appendChild(txt);
    }

    // X-axis Date Labels (Sample 6-8 dates)
    var stepDates = Math.max(1, Math.floor(count / 6));
    points.forEach(function (pt, idx) {
      if (idx % stepDates === 0 || idx === count - 1) {
        var dTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        dTxt.setAttribute('x', pt.x);
        dTxt.setAttribute('y', height - 12);
        dTxt.setAttribute('text-anchor', 'middle');
        dTxt.setAttribute('fill', '#64748b');
        dTxt.setAttribute('font-size', '10px');
        dTxt.textContent = pt.date.slice(5); // e.g. "09-28"
        svg.appendChild(dTxt);
      }
    });

    if (points.length > 0) {
      // Area Path
      var areaD = 'M ' + points[0].x + ' ' + (padTop + chartH);
      points.forEach(function (pt) {
        areaD += ' L ' + pt.x + ' ' + pt.y;
      });
      areaD += ' L ' + points[points.length - 1].x + ' ' + (padTop + chartH) + ' Z';

      var areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      areaPath.setAttribute('d', areaD);
      areaPath.setAttribute('fill', 'url(#cpAnalyticsGrad)');
      svg.appendChild(areaPath);

      // Line Path
      var lineD = 'M ' + points[0].x + ' ' + points[0].y;
      for (var p = 1; p < points.length; p++) {
        lineD += ' L ' + points[p].x + ' ' + points[p].y;
      }

      var strokePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      strokePath.setAttribute('d', lineD);
      strokePath.setAttribute('fill', 'none');
      strokePath.setAttribute('stroke', '#0678f9');
      strokePath.setAttribute('stroke-width', '2.5');
      strokePath.setAttribute('stroke-linecap', 'round');
      strokePath.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(strokePath);

      // Points & Hit Targets
      points.forEach(function (pt) {
        var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', pt.x);
        dot.setAttribute('cy', pt.y);
        dot.setAttribute('r', '4');
        dot.setAttribute('fill', '#0678f9');
        dot.setAttribute('stroke', '#0f172a');
        dot.setAttribute('stroke-width', '2');
        dot.setAttribute('class', 'cp-chart-dot');
        dot.style.pointerEvents = 'none';
        dot.style.transition = 'r 0.15s ease, fill 0.15s ease';
        svg.appendChild(dot);

        var hit = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        hit.setAttribute('cx', pt.x);
        hit.setAttribute('cy', pt.y);
        hit.setAttribute('r', '14');
        hit.setAttribute('fill', 'transparent');
        hit.style.cursor = 'pointer';

        hit.addEventListener('mouseenter', function () {
          dot.setAttribute('r', '6');
          dot.setAttribute('fill', '#60a5fa');
          showTooltip(pt, metric);
        });

        hit.addEventListener('mousemove', function (e) {
          moveTooltip(e);
        });

        hit.addEventListener('mouseleave', function () {
          dot.setAttribute('r', '4');
          dot.setAttribute('fill', '#0678f9');
          hideTooltip();
        });

        svg.appendChild(hit);
      });
    }

    container.appendChild(svg);
  }

  // Floating Tooltip
  var tooltip = document.getElementById('cp-chart-floating-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'cp-chart-floating-tooltip';
    tooltip.style.display = 'none';
    tooltip.style.position = 'fixed';
    tooltip.style.zIndex = '99999';
    tooltip.style.background = 'rgba(15, 23, 42, 0.95)';
    tooltip.style.backdropFilter = 'blur(10px)';
    tooltip.style.border = '1px solid #0678f9';
    tooltip.style.borderRadius = '8px';
    tooltip.style.padding = '8px 12px';
    tooltip.style.color = '#ffffff';
    tooltip.style.fontSize = '0.8rem';
    tooltip.style.boxShadow = '0 10px 25px rgba(0, 0, 0, 0.5)';
    tooltip.style.pointerEvents = 'none';
    tooltip.style.whiteSpace = 'nowrap';
    document.body.appendChild(tooltip);
  }

  function showTooltip(pt, metric) {
    var raw = pt.raw;
    var html = '<div style="color:#94a3b8; font-size:0.72rem; margin-bottom:4px;">' + pt.date + '</div>';

    if (metric === 'tokens') {
      html += '<div style="font-weight:700; color:#60a5fa; font-size:0.95rem; margin-bottom:4px;">' + Number(pt.val).toLocaleString() + ' Total Tokens</div>';
      html += '<div style="font-size:0.75rem; color:#cbd5e1; display:flex; gap:10px;">';
      html += '<span>In: <strong style="color:#38bdf8;">' + Number(raw.inputTokens || 0).toLocaleString() + '</strong></span>';
      html += '<span>Out: <strong style="color:#a855f7;">' + Number(raw.outputTokens || 0).toLocaleString() + '</strong></span>';
      html += '</div>';
    } else if (metric === 'cost') {
      html += '<div style="font-weight:700; color:#10b981; font-size:0.95rem;">$' + Number(pt.val).toFixed(4) + '</div>';
      html += '<div style="font-size:0.75rem; color:#94a3b8; margin-top:2px;">Tokens: ' + Number(raw.tokens || 0).toLocaleString() + '</div>';
    } else if (metric === 'conversations') {
      html += '<div style="font-weight:700; color:#38bdf8; font-size:0.95rem;">' + pt.val + ' Conversations</div>';
      html += '<div style="font-size:0.75rem; color:#94a3b8; margin-top:2px;">Leads: ' + (raw.leads || 0) + '</div>';
    } else if (metric === 'leads') {
      html += '<div style="font-weight:700; color:#a855f7; font-size:0.95rem;">' + pt.val + ' Leads Captured</div>';
    } else if (metric === 'ai_requests') {
      html += '<div style="font-weight:700; color:#3b82f6; font-size:0.95rem;">' + pt.val + ' AI Requests</div>';
    }

    tooltip.innerHTML = html;
    tooltip.style.display = 'block';
  }

  function moveTooltip(e) {
    tooltip.style.left = (e.clientX + 14) + 'px';
    tooltip.style.top = (e.clientY - 42) + 'px';
  }

  function hideTooltip() {
    tooltip.style.display = 'none';
  }

  // Event Listeners
  if (select) {
    select.addEventListener('change', renderChart);
  }

  window.addEventListener('resize', renderChart);

  // Initial Render
  renderChart();
})();
