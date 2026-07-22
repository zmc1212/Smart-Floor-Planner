function prioritizeProcessingTasks(items) {
  const tasks = Array.isArray(items) ? items : [];
  return tasks.filter((item) => item.status === 'processing')
    .concat(tasks.filter((item) => item.status !== 'processing'));
}

module.exports = {
  prioritizeProcessingTasks,
};
