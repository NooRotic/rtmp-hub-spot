import { useState, useEffect } from 'react';

export const useMediaDevices = () => {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  const updateDevices = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      console.warn('[useMediaDevices] Media devices API not available (possibly insecure origin)');
      return;
    }
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      setDevices(allDevices);
    } catch (err) {
      console.error('Error enumerating devices:', err);
    }
  };

  useEffect(() => {
    updateDevices();
    
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', updateDevices);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', updateDevices);
      };
    }
  }, []);

  const videoDevices = devices.filter(d => d.kind === 'videoinput');
  const audioDevices = devices.filter(d => d.kind === 'audioinput');

  return { videoDevices, audioDevices, refreshDevices: updateDevices };
};
