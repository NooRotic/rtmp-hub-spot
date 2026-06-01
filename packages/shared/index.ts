export interface StreamInfo {
  id: string;
  userId: string;
  userName: string;
  startTime: number;
  type: 'webcam' | 'screen';
}

export interface UserInfo {
  id: string;
  name: string;
  role: 'admin' | 'user';
}

export interface RtmpDestination {
  id: string;
  name: string;
  url: string;
  streamKey: string;
  enabled: boolean;
  encoder?: 'nvenc' | 'amf' | 'qsv' | 'software';
}
