export interface RemoteTrack {
	externalId: string;
	title: string;
	artist: string;
	artists: string[];
	album?: string | null;
	albumArtist?: string | null;
	durationMs?: number | null;
	artworkUrl?: string | null;
	trackNumber?: number | null;
	discNumber?: number | null;
	year?: number | null;
	position: number;
}

export interface RemoteCollection {
	name: string;
	owner: string | null;
	artworkUrl: string | null;
	/** Canonical id to store (e.g. YouTube channel handle resolved to UC… id) */
	externalId?: string;
	items: RemoteTrack[];
	/** The provider only returned part of the collection */
	truncated: boolean;
}
