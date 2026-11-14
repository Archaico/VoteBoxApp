// src/components/AttachmentImage.tsx
//
// Renders a proposal attachment by CID, retrying through the gateway
// fallback chain (blockchainService.getAttachmentUrls) if a gateway is
// slow/unpropagated. Single-gateway loads with no retry were silently
// failing cross-device even though the upload itself succeeded.
// A gateway that hangs (no error, no image) is skipped after STALL_MS.

import React, { useEffect, useState } from 'react';
import { Image, ImageStyle, StyleProp } from 'react-native';
import { blockchainService } from '../services/BlockchainService';

const STALL_MS = 8000;

interface AttachmentImageProps {
  cid: string;
  style: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
}

export function AttachmentImage({ cid, style, resizeMode }: AttachmentImageProps) {
  const [urls] = useState(() => blockchainService.getAttachmentUrls(cid));
  const [urlIndex, setUrlIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded || urlIndex >= urls.length) return;
    const timer = setTimeout(() => setUrlIndex(i => i + 1), STALL_MS);
    return () => clearTimeout(timer);
  }, [urlIndex, loaded, urls.length]);

  if (urlIndex >= urls.length) return null;

  return (
    <Image
      source={{ uri: urls[urlIndex] }}
      style={style}
      resizeMode={resizeMode}
      onLoad={() => setLoaded(true)}
      onError={() => setUrlIndex(i => i + 1)}
    />
  );
}
