function dateText(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function timeText(date) {
  const d = new Date(date);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function appointmentDates(offset, maxAdvanceDays) {
  const count = Math.min(5, Math.max(0, maxAdvanceDays - offset + 1));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + offset + index);
    return {
      key: dateText(date),
      label: offset + index === 0 ? '今天' : offset + index === 1 ? '明天' : `周${'日一二三四五六'[date.getDay()]}`,
    };
  });
}

function formatConfirmRescheduleLabel({ selectedSlot } = {}) {
  if (!selectedSlot || !selectedSlot.startAt) return '确认改期至可用时段';
  const start = new Date(selectedSlot.startAt);
  if (Number.isNaN(start.getTime())) return '确认改期至可用时段';
  return `确认改期至${start.getMonth() + 1}月${start.getDate()}日 ${timeText(start)}`;
}

module.exports = {
  dateText,
  timeText,
  appointmentDates,
  formatConfirmRescheduleLabel,
};
