// 格式化数字显示
const formatNumber = (num) => {
  if (!num && num !== 0) return '';
  const n = Number(num);
  if (isNaN(n)) return '';
  return n.toLocaleString();
};

module.exports = {
  formatNumber
};