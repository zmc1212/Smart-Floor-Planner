// Authorized citation images live only while the source sheet is open.
class ReferenceImage {
  constructor() { this.epoch = 0; this.paths = []; }
  clear() {
    this.epoch += 1;
    for (const path of this.paths) wx.getFileSystemManager().unlink({ filePath: path, fail() {} });
    this.paths = [];
  }
  async materialize(citation) {
    if (!citation.available || !citation.reference) return citation;
    const epoch = this.epoch;
    const { imageBase64, ...reference } = citation.reference;
    if (!/^[1-9]\d*$/.test(String(citation.id)) || reference.mimeType !== 'image/jpeg' || typeof imageBase64 !== 'string' || imageBase64.length > 409600) throw { code: 'invalid_response' };
    const path = `${wx.env.USER_DATA_PATH}/assistant-reference-${citation.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    await new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({ filePath: path, data: imageBase64, encoding: 'base64', success: resolve, fail: reject }));
    if (epoch !== this.epoch) { wx.getFileSystemManager().unlink({ filePath: path, fail() {} }); throw { code: 'context_changed' }; }
    this.paths.push(path);
    return { ...citation, reference, imagePath: path };
  }
}
module.exports = { ReferenceImage };
