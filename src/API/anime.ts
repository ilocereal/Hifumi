import axios, {AxiosInstance, AxiosResponse} from "axios";
import {getAnimeQueryResponse, ICharacter, IVoiceActor, MALResponse, WhatAnimeSearchResponse} from "./anime.interface";
import {promisify} from "util";
import {Attachment, Message, MessageOptions, RichEmbed, TextChannel} from "discord.js";
import getAnimeEmbed from "../embeds/commands/fun/anime/getAnimeEmbed";
import animeNotFoundEmbed from "../embeds/commands/fun/anime/animeNotFoundEmbed";
import nsfwAnimeWarningEmbed from "../embeds/commands/fun/anime/nsfwAnimeWarningEmbed";
import gb from "../misc/Globals";
import {Environments} from "../events/systemStartup";
import {debug} from "../utility/Logging";
import getCharacterEmbed from "../embeds/commands/fun/anime/getCharacterEmbed";
import characterNotFoundEmbed from "../embeds/commands/fun/anime/characterNotFoundEmbed";
import {AnimeUtils} from "../utility/animeUtils";
import {normalizeString, StringUtils} from "../utility/Util";
import {fetchUrlAsBase64} from "./utils";
import whatAnimeEmbed from "../embeds/commands/fun/anime/whatAnimeEmbed";
import {handleFailedCommand} from "../embeds/commands/commandExceptionEmbed";

const fs = require('fs');
const readFile = promisify(fs.readFile);

export default class Anime {
    private readonly endpoint = 'https://graphql.anilist.co/';
    private readonly MALEndpoint = 'https://myanimelist.net/search/prefix.json?type=all&keyword=';
    private static _instance: Anime;
    private readonly clientId: string;
    private readonly clientSecret: string;
    private anilist: AxiosInstance;
    private whatanime: AxiosInstance;
    private tokenExpiration: number;
    private readonly whatanimeKey: string;

    private constructor() {
        if (gb.ENV === Environments.Development) {
            const settings = require('../../config0.json');
            this.clientId = settings.anilist.client_id;
            this.clientSecret = settings.anilist.client_secret;
            this.whatanimeKey = settings.whatanime.API_KEY;
        } else {
            const client_id = process.env['ANILIST_CLIENT_ID'];
            const client_secret = process.env['ANILIST_CLIENT_SECRET'];
            const what_anime_key = process.env['WHAT_ANIME_KEY'];
            if (!client_id || !client_secret || !what_anime_key) {
                throw new Error("Required Anime environment variables were not set in production")
            }
            this.clientId = client_id;
            this.clientSecret = client_secret;
            this.whatanimeKey = what_anime_key;
        }
        this.anilist = axios.create({
            baseURL: this.endpoint,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
        this.whatanime = axios.create({
            baseURL: 'https://whatanime.ga/api/'
        });
    }

    public static getInstance(): Anime {
        if (!Anime._instance) {
            Anime._instance = new this();
        }
        return Anime._instance;
    }

    private static async getQuery(query: string): Promise<string> {
        return await readFile(`src/API/graphql/queries/${query}.graphql`, {encoding: 'utf8'})
    }


    public async getAnime(message: Message, anime: string): Promise<RichEmbed> {
        /**
         * Why do you do it like this you ask? As much as I love AniList it has a god
         * awful search system.
         */
        const res: AxiosResponse<MALResponse> = await axios.get(encodeURI(this.MALEndpoint + anime));

        const MALId: number | undefined = AnimeUtils.getRelevantMALId(res.data, anime);
        if (!MALId) {
            return await animeNotFoundEmbed(message.guild.id, 'anime')
        }
        const response: AxiosResponse<{ data: { Media: getAnimeQueryResponse } }> = await this.anilist.post(`/`,
            JSON.stringify({
                query: await Anime.getQuery('getAnimeByMalId'),
                variables: {
                    id: MALId
                }
            }));

        const data = response.data.data.Media;
        if (data.isAdult && message.channel instanceof TextChannel && !message.channel.nsfw) {
            return nsfwAnimeWarningEmbed();
        }
        return getAnimeEmbed(data);
    }

    public async getAnimeByAnilistId(id: string) {
        const response: AxiosResponse<{ data: { Media: getAnimeQueryResponse } }> = await this.anilist.post(`/`,
            JSON.stringify({
                query: await Anime.getQuery('getAnimeByAnilistId'),
                variables: {
                    id: id
                }
            }));
        return response.data.data.Media;
    }

    public async getCharacter(message: Message, character: string) {
        console.log(character);
        try {
            const response: AxiosResponse<{ data: { Character: ICharacter } }> = await this.anilist.post(`/`,
                JSON.stringify({
                        query: await Anime.getQuery('getCharacter'),
                        variables: {
                            search: character
                        }
                    }
                ));
            const data = response.data.data.Character;
            let VA: IVoiceActor | undefined;
            if (data.media && data.media.edges.length) {
                const medias = data.media.edges.filter(
                    i => i.node && i.node.type === 'ANIME'
                );
                // might be slightly wrong but it's fine
                const chosenMedia = medias[0];
                if (chosenMedia && chosenMedia.voiceActors && chosenMedia.voiceActors.length) {
                    VA = await this.getVoiceActor(chosenMedia.voiceActors[0].id);
                }
            }
            return getCharacterEmbed(data, VA);
        }
        catch (err) {
            debug.error(err, `getCharacter`);
            if (!err.response) {
                return Promise.reject(err);
            }
            if (err.response.status === 404) {
                return await characterNotFoundEmbed(message.guild.id)
            }
            return Promise.reject(err);
        }
    }

    public async getVoiceActor(id: number): Promise<IVoiceActor | undefined> {
        try {
            const response: AxiosResponse<{ data: { Staff: IVoiceActor } }> = await this.anilist.post(`/`,
                JSON.stringify({
                    query: await Anime.getQuery('getVoiceActorById'),
                    variables: {
                        id: id
                    }
                }));
            return response.data.data.Staff;
        }
        catch (err) {
            debug.error(err, `Anime`);
            return undefined;
        }
    }

    public async reverseSearch(picture: string, isGif: boolean): Promise<[(RichEmbed | string), (Attachment | undefined)]> {
        let base64: string;
        if (StringUtils.isUrl(picture)) {

            let buffer = await fetchUrlAsBase64(picture, isGif);
            if (!buffer) {
                return ["Not a valid image", undefined];
            }
            base64 = buffer;
        } else {
            // we probably shouldn't be trusting here but whatever
            base64 = picture;
        }

        let response: AxiosResponse<WhatAnimeSearchResponse | string>;
        try {
            response = await axios.post(`https://whatanime.ga/api/search?token=${this.whatanimeKey}`,
                `image=${base64}`,
                {headers: {'Content-Type': 'application/x-www-form-urlencoded', 'charset': 'UTF-8'}});

        } catch (e) {
            if (e.status === 413){
                return [
                    "That is a _pretty_ gigantic image. There's a 1MB upload limit, choose something smaller.",
                    undefined
                ]
            }
            return [`Something went wrong [Status Code (${e.status})]`, undefined]
        }

        const data = response.data;

        if (response.status === 413){
        }
        if (typeof data === 'string'){
            return [data, undefined];
        }


        const result = data.docs[0];

        if (result.similarity < 0.85){
            return ['Could not find an accurate result', undefined];
        }

        const [buffer, anilistResponse] = await Promise.all([
            this.getReverseSearchGif(result.anilist_id, result.filename, result.at, result.tokenthumb),
            this.getAnimeByAnilistId(result.anilist_id.toString())
        ]);
        const parsed = AnimeUtils.parseAnilistResponse(anilistResponse);
        const embed = whatAnimeEmbed(parsed, result.episode, result.similarity, buffer);
        const mediaTitle = normalizeString(result.title_english + '_Episode_' + result.episode + '.mp4');
        return [embed, new Attachment(buffer, mediaTitle)];
    }

    private async getReverseSearchGif(anilist_id: number, filename: string, at: number, token: string) {
        const response = await axios.get(
            `https://whatanime.ga/preview.php?anilist_id=${anilist_id}&file=${encodeURIComponent(filename)}&t=${at}&token=${token}`,
            {responseType: 'arraybuffer'});
        return response.data
    }
}
