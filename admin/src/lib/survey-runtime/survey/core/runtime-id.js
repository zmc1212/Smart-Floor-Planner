let idSeed = 1;

function nowIso() {
  return new Date().toISOString();
}

function nextId(prefix) {
  idSeed += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeed}`;
}

module.exports = {
  nowIso,
  nextId
};
