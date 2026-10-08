export interface Social {
  name: string;
  icon: string;
  url?: string;
  encodedEmail?: string;
}
export interface HomeData {
  profile: { name: string; bio: string; avatar: string };
  socials: Social[];
  blogUrl: string;
  logo: string;
  defaultWallpaper: { desktop: { video: string; poster: string }; mobile: { video: string; poster: string } };
  wallpapers: { desktop: string[]; mobile: string[] };
  tracks: { id: string; name: string; artist: string; url: string; cover: string; lrc?: string }[];
  accentHue: number;
}
export type IconData = { body: string; width: number; height: number };
