function prioritizeProcessingTasks(items) {
  const tasks = Array.isArray(items) ? items : [];
  const activeStatuses = new Set(['created', 'pending', 'processing']);
  return tasks.filter((item) => activeStatuses.has(item.status))
    .concat(tasks.filter((item) => !activeStatuses.has(item.status)));
}

module.exports = {
  prioritizeProcessingTasks,
};
