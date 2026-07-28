// src/components/AttachmentImage.tsx
//
// Renders a proposal attachment by CID, retrying through the gateway
// fallback chain (blockchainService.getAttachmentUrls) if a gateway is
// slow/unpropagated. Single-gateway loads with no retry were silently
// failing cross-device even though the upload itself succeeded.

import React, { useState } from 'react';
import { Image, ImageStyle, StyleProp } from 'react-native';
import { blockchainService } from '../services/BlockchainService';

interface AttachmentImageProps {
  cid: string;
  style: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
}

export function AttachmentImage({ cid, style, resizeMode }: AttachmentImageProps) {
  const [urls] = useState(() => blockchainService.getAttachmentUrls(cid));
  const [urlIndex, setUrlIndex] = useState(0);

  if (urlIndex >= urls.length) return null;

  return (
    <Image
      source={{ uri: urls[urlIndex] }}
      style={style}
      resizeMode={resizeMode}
      onError={() => setUrlIndex(i => i + 1)}
    />
  );
}
