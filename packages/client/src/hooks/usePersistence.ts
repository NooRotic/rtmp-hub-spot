import { useEffect } from 'react';

// Effect for persistence of device selections to localStorage
export function usePersistence(selectedVideo: string, selectedAudio: string) {
  useEffect(() => {
    localStorage.setItem('hub-video-device', selectedVideo);
  }, [selectedVideo]);

  useEffect(() => {
    localStorage.setItem('hub-audio-device', selectedAudio);
  }, [selectedAudio]);
}
