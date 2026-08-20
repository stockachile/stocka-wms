// ========================================================
// RE-DISEÑO DE CALENDARIO OPERACIONAL STOCKA WMS (COMPACTO)
// ========================================================

window.toggleCalendarGridVisibility = function() {
  const wrapper = document.getElementById('cal-grid-body-wrapper');
  const btn = document.getElementById('cal-toggle-grid');
  if (!wrapper || !btn) return;
  
  const isHidden = wrapper.style.display === 'none';
  if (isHidden) {
    wrapper.style.display = 'block';
    localStorage.setItem('wms_calendar_expanded', 'true');
    btn.innerHTML = `<i class="ri-eye-off-line"></i> <span>Colapsar</span>`;
  } else {
    wrapper.style.display = 'none';
    localStorage.setItem('wms_calendar_expanded', 'false');
    btn.innerHTML = `<i class="ri-eye-line"></i> <span>Ver Mes</span>`;
  }
};

window.renderCalendarUI = function(events, currentDate, selectedDateStr) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay(); // 0 is Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  // Adjust so Monday is 0, Sunday is 6
  const startDay = firstDay === 0 ? 6 : firstDay - 1; 

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const isExpanded = localStorage.getItem('wms_calendar_expanded') !== 'false';

  let gridHtml = `
    <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.65rem 0.85rem; border-bottom: 1px solid var(--color-border); background: var(--color-surface); box-sizing: border-box; width: 100%;">
      <div style="display: flex; align-items: center; gap: 0.35rem;">
        <button id="cal-prev-month" class="btn btn-outline btn-sm" style="padding: 0.2rem 0.4rem; font-size: 0.8rem; background: var(--color-bg);"><i class="ri-arrow-left-s-line"></i></button>
        <h4 style="margin: 0; font-weight: 700; color: var(--color-text-main); font-size: 0.825rem; min-width: 90px; text-align: center;">${monthNames[month]} ${year}</h4>
        <button id="cal-next-month" class="btn btn-outline btn-sm" style="padding: 0.2rem 0.4rem; font-size: 0.8rem; background: var(--color-bg);"><i class="ri-arrow-right-s-line"></i></button>
      </div>
      <button id="cal-toggle-grid" onclick="window.toggleCalendarGridVisibility()" class="btn btn-outline btn-sm" style="padding: 0.25rem 0.5rem; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 0.25rem; font-weight: 600;" title="Expandir/Colapsar vista mensual del calendario">
        <i class="${isExpanded ? 'ri-eye-off-line' : 'ri-eye-line'}"></i>
        <span>${isExpanded ? 'Colapsar' : 'Ver Mes'}</span>
      </button>
    </div>
    
    <div id="cal-grid-body-wrapper" style="display: ${isExpanded ? 'block' : 'none'}; padding: 0.85rem; background: var(--color-surface); box-sizing: border-box; width: 100%;">
      <div style="display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-weight: 700; color: var(--color-text-muted); font-size: 0.7rem; margin-bottom: 0.4rem; text-transform: uppercase;">
        <div>Lu</div><div>Ma</div><div>Mi</div><div>Ju</div><div>Vi</div><div>Sá</div><div>Do</div>
      </div>
      <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.2rem;">
  `;

  for (let i = 0; i < startDay; i++) {
    gridHtml += `<div style="padding: 0.35rem 0; text-align: center;"></div>`;
  }

  const todayStr = new Date().toISOString().split('T')[0];

  for (let day = 1; day <= daysInMonth; day++) {
    const dStr = `${year}-${String(month+1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayEvents = events.filter(e => {
      const datePart = e.event_date.split('T')[0].split(' ')[0];
      return datePart === dStr;
    });
    const hasEvents = dayEvents.length > 0;
    const isSelected = selectedDateStr === dStr;
    const isToday = dStr === todayStr;

    let cellStyle = `padding: 0.35rem 0.15rem; text-align: center; border-radius: var(--radius-sm); cursor: pointer; transition: all 0.15s; font-size: 0.8rem; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 38px; box-sizing: border-box;`;
    let bgCol = 'transparent';

    if (isSelected) {
      cellStyle += ` background-color: var(--color-primary); color: white; font-weight: 700; box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.4);`;
    } else if (isToday) {
      bgCol = 'rgba(59, 130, 246, 0.08)';
      cellStyle += ` background-color: ${bgCol}; color: var(--color-primary); font-weight: 700; border: 1px solid rgba(59, 130, 246, 0.35);`;
    } else if (hasEvents) {
      let borderCol = '#2563eb';
      bgCol = 'rgba(37, 99, 235, 0.07)';

      const hasAlert = dayEvents.some(e => e.color_type === 'alert' || e.color_type === 'danger');
      const hasWarning = dayEvents.some(e => e.color_type === 'warning');
      const hasSuccess = dayEvents.some(e => e.color_type === 'success');

      if (hasAlert) {
        borderCol = '#ef4444';
        bgCol = 'rgba(239, 68, 68, 0.07)';
      } else if (hasWarning) {
        borderCol = '#f59e0b';
        bgCol = 'rgba(245, 158, 11, 0.07)';
      } else if (hasSuccess) {
        borderCol = '#10b981';
        bgCol = 'rgba(16, 185, 129, 0.07)';
      }

      cellStyle += ` background-color: ${bgCol}; border-bottom: 3.5px solid ${borderCol}; color: var(--color-text-main); font-weight: 750; border-bottom-left-radius: 0; border-bottom-right-radius: 0;`;
    } else {
      cellStyle += ` color: var(--color-text-main); font-weight: 500;`;
    }

    gridHtml += `
      <div class="cal-day-cell" data-date="${dStr}" style="${cellStyle}" onmouseover="if(!${isSelected}) this.style.backgroundColor='var(--color-surface-hover)'" onmouseout="if(!${isSelected}) this.style.backgroundColor='${bgCol}'">
        <span>${day}</span>
      </div>
    `;
  }
  
  gridHtml += `</div></div>`;
  return gridHtml;
};

window.renderEventsListUI = function(events, selectedDateStr) {
  let filteredEvents = events;
  let title = 'Próximos Eventos';

  // 1. Configurar Fecha de Hoy en un cuadro de status
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const todayFormatted = today.toLocaleDateString('es-CL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const todayEvents = events.filter(e => {
    const datePart = e.event_date.split('T')[0].split(' ')[0];
    return datePart === todayStr;
  });

  let todayStatusBg = 'rgba(16, 185, 129, 0.07)';
  let todayStatusColor = '#10b981';
  let todayStatusIcon = 'ri-checkbox-circle-line';
  let todayStatusLabel = 'Sin eventos hoy';

  if (todayEvents.length > 0) {
    const hasAlert = todayEvents.some(e => e.color_type === 'alert' || e.color_type === 'warning');
    todayStatusBg = hasAlert ? 'rgba(239, 68, 68, 0.07)' : 'rgba(37, 99, 235, 0.07)';
    todayStatusColor = hasAlert ? '#ef4444' : '#2563eb';
    todayStatusIcon = hasAlert ? 'ri-alert-line' : 'ri-notification-3-line';
    todayStatusLabel = `${todayEvents.length} ${todayEvents.length === 1 ? 'evento hoy' : 'eventos hoy'}`;
  }

  const todayCardHtml = `
    <div style="background: var(--color-bg); padding: 0.75rem 1rem; border-bottom: 1px solid var(--color-border); display: flex; align-items: center; justify-content: space-between; box-sizing: border-box; width: 100%;">
      <div>
        <div style="font-size: 0.68rem; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Fecha de Hoy</div>
        <div style="font-size: 0.85rem; font-weight: 800; color: var(--color-text-main);">${todayFormatted}</div>
      </div>
      <span style="background: ${todayStatusBg}; color: ${todayStatusColor}; font-weight: 700; font-size: 0.72rem; padding: 0.25rem 0.65rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 0.3rem;">
        <i class="${todayStatusIcon}"></i> ${todayStatusLabel}
      </span>
    </div>
  `;

  if (selectedDateStr) {
    filteredEvents = events.filter(e => e.event_date.startsWith(selectedDateStr));
    const [y, m, d] = selectedDateStr.split('-');
    title = `Eventos del ${d}/${m}/${y}`;
  } else {
    filteredEvents = events.filter(e => e.event_date >= todayStr).slice(0, 5);
  }

  let listHtml = '';
  if (filteredEvents.length === 0) {
    listHtml = `
      <div style="padding: 2rem 1.5rem; text-align: center; color: var(--color-text-muted); font-size: 0.8rem; box-sizing: border-box; width: 100%;">
        <i class="ri-calendar-check-line" style="font-size: 2.2rem; display: block; margin-bottom: 0.5rem; opacity: 0.3;"></i>
        No hay eventos programados para esta fecha.
      </div>`;
  } else {
    listHtml = filteredEvents.map(e => {
      const datePart = e.event_date.split('T')[0].split(' ')[0];
      const [y,m,d] = datePart.split('-');
      const eDate = new Date(y, m - 1, d);
      const day = String(eDate.getDate()).padStart(2, '0');
      const month = eDate.toLocaleString('es', { month: 'short' });
      
      const timePart = e.event_date.includes('T') ? e.event_date.split('T')[1].slice(0, 5) : '';
      const timeStr = timePart && timePart !== '00:00' ? timePart : '';

      let colorClass = e.color_type || 'primary';
      if (colorClass === 'info') colorClass = 'primary';
      if (colorClass === 'alert') colorClass = 'danger';
      
      return `
        <div class="compact-event-row" style="display: flex; flex-direction: column; border-bottom: 1px solid var(--color-border); transition: background-color 0.15s; width: 100%; box-sizing: border-box;" onmouseover="this.style.backgroundColor='var(--color-surface-hover)'" onmouseout="this.style.backgroundColor='transparent'">
          <div style="display: flex; align-items: center; gap: 0.65rem; padding: 0.55rem 0.85rem; cursor: pointer; user-select: none;" onclick="const desc = this.nextElementSibling; if(desc) { desc.style.display = desc.style.display === 'none' ? 'block' : 'none'; }">
            <div style="width: 4px; height: 26px; background-color: var(--color-${colorClass}); border-radius: 2px; flex-shrink: 0;"></div>
            <div style="flex: 1; min-width: 0;">
              <h5 style="margin: 0; font-size: 0.825rem; font-weight: 700; color: var(--color-text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${e.title}">${e.title}</h5>
              <div style="font-size: 0.72rem; color: var(--color-text-muted); display: flex; align-items: center; gap: 0.35rem; margin-top: 0.05rem;">
                <span><i class="ri-calendar-line"></i> ${day} ${month}</span>
                ${timeStr ? `<span>• <i class="ri-time-line"></i> ${timeStr}</span>` : ''}
                ${e.description ? `<span style="color: var(--color-primary); font-weight: 600; margin-left: 0.2rem;"><i class="ri-information-line"></i> Detalles</span>` : ''}
              </div>
            </div>
            ${e.description ? `<i class="ri-arrow-down-s-line" style="color: var(--color-text-muted); font-size: 0.85rem;"></i>` : ''}
          </div>
          ${e.description ? `
            <div style="display: none; padding: 0.4rem 0.85rem 0.65rem 1.65rem; font-size: 0.78rem; color: var(--color-text-muted); line-height: 1.45; border-top: 1px dashed var(--color-border); margin-top: -0.15rem; background: rgba(0,0,0,0.01); box-sizing: border-box; width: 100%;">
              ${e.description}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  return `
    ${todayCardHtml}
    <div style="padding: 0.6rem 0.85rem; border-bottom: 1px solid var(--color-border); background-color: var(--color-surface); box-sizing: border-box; width: 100%;">
      <h4 style="margin: 0; font-size: 0.825rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.4rem; font-weight: 700;">
        <i class="ri-list-check" style="color: var(--color-primary);"></i> ${title}
      </h4>
    </div>
    <div style="max-height: 250px; overflow-y: auto; box-sizing: border-box; width: 100%;">
      ${listHtml}
    </div>
  `;
};
