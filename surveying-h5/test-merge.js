const fs = require('fs');
const path = require('path');

const kernelPath = path.join(__dirname, '../miniprogram/utils/survey/legacy-kernel.js');
let kernelCode = fs.readFileSync(kernelPath, 'utf8');

kernelCode += 
module.exports = {
  // Use existing exported object
};
;

const tempKernelPath = path.join(__dirname, 'temp-kernel-merge-test.js');
fs.writeFileSync(tempKernelPath, kernelCode);

const kernel = require('./temp-kernel-merge-test.js');
console.log(Object.keys(kernel));
fs.unlinkSync(tempKernelPath);
