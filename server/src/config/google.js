import { google } from 'googleapis';
import env from './env.js';

export function oauthClient(redirectUri) {
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri);
}

export const LOGIN_SCOPES = ['openid', 'email', 'profile'];
export const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

export { google };
