window.renderCalendarUI = function(events, currentDate, selectedDateStr) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay(); // 0 is Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  // Adjust so Monday is 0, Sunday is 6
  const startDay = firstDay === 0 ? 6 : firstDay - 1; 

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  
  let gridHtml = `
    <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; border-bottom: 1px solid var(--color-border);">
      <button id="cal-prev-month" class="btn btn-outline" style="padding: 0.25rem 0.5rem; border-color: var(--color-border); background: var(--color-surface);"><i class="ri-arrow-left-s-line"></i></button>
      <h4 style="margin: 0; font-weight: 700; color: var(--color-text-main);">${monthNames[month]} ${year}</h4>
      <button id="cal-next-month" class="btn btn-outline" style="padding: 0.25rem 0.5rem; border-color: var(--color-border); background: var(--color-surface);"><i class="ri-arrow-right-s-line"></i></button>
    </div>
    <div style="padding: 1rem;">
      <div style="display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-weight: 700; color: var(--color-text-muted); font-size: 0.75rem; margin-bottom: 0.5rem; text-transform: uppercase;">
        <div>Lu</div><div>Ma</div><div>Mi</div><div>Ju</div><div>Vi</div><div>Sá</div><div>Do</div>
      </div>
      <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.25rem;">
  `;

  for (let i = 0; i < startDay; i++) {
    gridHtml += `<div style="padding: 0.5rem; text-align: center;"></div>`;
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

    let dotHtml = '';
    if (hasEvents) {
      dotHtml = `<div style="display: flex; justify-content: center; gap: 3px; margin-top: 4px;">
        ${dayEvents.slice(0,3).map(e => {
            let col = e.color_type || 'primary';
            if (col === 'info') col = 'primary';
            if (col === 'alert') col = 'danger';
            return `<div style="width: 6px; height: 6px; border-radius: 50%; background-color: var(--color-${col});"></div>`;
        }).join('')}
      </div>`;
    }

    let cellStyle = `padding: 0.5rem 0.25rem; text-align: center; border-radius: var(--radius-sm); cursor: pointer; transition: all 0.2s; font-size: 0.85rem; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 45px;`;
    if (isSelected) {
      cellStyle += ` background-color: var(--color-primary); color: white; font-weight: 700; box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.4);`;
    } else if (isToday) {
      cellStyle += ` background-color: rgba(59, 130, 246, 0.1); color: var(--color-primary); font-weight: 700; border: 1px solid rgba(59, 130, 246, 0.3);`;
    } else {
      cellStyle += ` color: var(--color-text-main); font-weight: 500;`;
    }

    gridHtml += `
      <div class="cal-day-cell" data-date="${dStr}" style="${cellStyle}" onmouseover="if(!${isSelected}) this.style.backgroundColor='var(--color-surface-hover)'" onmouseout="if(!${isSelected}) this.style.backgroundColor='${isToday ? 'rgba(59, 130, 246, 0.1)' : 'transparent'}'">
        <span>${day}</span>
        ${dotHtml}
      </div>
    `;
  }
  
  gridHtml += `</div></div>`;
  return gridHtml;
}

window.renderEventsListUI = function(events, selectedDateStr) {
  let filteredEvents = events;
  let title = 'Próximos Eventos';

  if (selectedDateStr) {
    filteredEvents = events.filter(e => e.event_date.startsWith(selectedDateStr));
    const [y, m, d] = selectedDateStr.split('-');
    title = `Eventos del ${d}/${m}/${y}`;
  } else {
    const todayStr = new Date().toISOString().split('T')[0];
    filteredEvents = events.filter(e => e.event_date >= todayStr).slice(0, 6);
  }

  if (filteredEvents.length === 0) {
    return `
      <div style="padding: 1rem; border-bottom: 1px solid var(--color-border); background-color: var(--color-surface); border-radius: 0 var(--radius-md) 0 0;">
        <h4 style="margin: 0; font-size: 0.9rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;"><i class="ri-list-check" style="color: var(--color-primary);"></i> ${title}</h4>
      </div>
      <div style="padding: 3rem 1.5rem; text-align: center; color: var(--color-text-muted); font-size: 0.85rem;">
        <i class="ri-calendar-check-line" style="font-size: 3rem; display: block; margin-bottom: 1rem; opacity: 0.3; color: var(--color-text-muted);"></i>
        No hay eventos programados para esta fecha.
      </div>`;
  }

  const listHtml = filteredEvents.map(e => {
    const datePart = e.event_date.split('T')[0].split(' ')[0];
    const [y,m,d] = datePart.split('-');
    const eDate = new Date(y, m - 1, d);
    const day = String(eDate.getDate()).padStart(2, '0');
    const month = eDate.toLocaleString('es', { month: 'short' });
    let colorClass = e.color_type || 'primary';
    if (colorClass === 'info') colorClass = 'primary';
    if (colorClass === 'alert') colorClass = 'danger';
    
    return `
      <div style="display: flex; gap: 1rem; padding: 1rem; border-bottom: 1px solid var(--color-border); align-items: flex-start; transition: background-color 0.2s; cursor: default;" onmouseover="this.style.backgroundColor='var(--color-surface-hover)'" onmouseout="this.style.backgroundColor='transparent'">
        <div style="text-align: center; min-width: 50px; background: var(--color-bg); padding: 0.5rem; border-radius: 8px; border: 1px solid var(--color-border); box-shadow: var(--shadow-sm);">
          <div style="font-size: 1.15rem; font-weight: 700; color: var(--color-text-main); line-height: 1;">${day}</div>
          <div style="font-size: 0.7rem; text-transform: uppercase; color: var(--color-${colorClass}); font-weight: 700; margin-top: 0.3rem;">${month}</div>
        </div>
        <div>
          <h4 style="margin: 0 0 0.25rem 0; font-size: 0.95rem; color: var(--color-text-main); font-weight: 600;">${e.title}</h4>
          <p style="margin: 0; font-size: 0.85rem; color: var(--color-text-muted); line-height: 1.5;">${e.description || 'Sin descripción adicional'}</p>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div style="padding: 1rem; border-bottom: 1px solid var(--color-border); background-color: var(--color-surface); border-radius: 0 var(--radius-md) 0 0;">
      <h4 style="margin: 0; font-size: 0.9rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
        <i class="ri-list-check" style="color: var(--color-primary);"></i> ${title}
      </h4>
    </div>
    <div style="max-height: 380px; overflow-y: auto;">
      ${listHtml}
    </div>
  `;
}
