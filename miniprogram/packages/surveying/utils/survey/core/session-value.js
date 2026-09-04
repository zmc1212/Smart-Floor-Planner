function copySessionValue(value) {
  if (Array.isArray(value)) return value.map(copySessionValue);
  if (value && typeof value === 'object') {
    const result = {};
    Object.keys(value).forEach(key => { result[key] = copySessionValue(value[key]); });
    return result;
  }
  return value;
}

module.exports = { copySessionValue };
