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
