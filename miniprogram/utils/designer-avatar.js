function designerAvatarPath(variant) {
  const name = variant === 'male' || variant === 'female' ? variant : 'neutral';
  return `/packages/assistant/assets/designer-avatar-${name}.png`;
}

module.exports = { designerAvatarPath };
