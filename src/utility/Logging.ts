import * as dbg from 'debug'
import * as Discord from'discord.js'
const cli = require('heroku-cli-util');

export let debug = {
    silly  : function(obj : any, identifier:string = ''){
        if (identifier !== '') identifier += ':';
        dbg(`Bot:${identifier}:Silly`)(cli.color.cyan(obj))
    },
    info   : function(obj : any,identifier:string = ''){
        if (identifier !== '') identifier += ':';
        dbg(`Bot:${identifier}Info`)(cli.color.green(obj))
    },
    warning: function(obj : any,identifier:string = ''){
        if (identifier !== '') identifier += ':';
        dbg(`Bot:${identifier}Warning`)(cli.color.yellow(obj))
    },
    error  : function(obj : any,identifier:string = ''){
        if (identifier !== '') identifier += ':';
        dbg(`Bot:${identifier}Error`)(cli.color.red(obj))
    }
};

interface GuildStats {
    name: string;
    members:number;
    channels: number;
}

export function startupTable(guilds : GuildStats[]){
    cli.styledHeader(`${guilds.length} guilds total.`);
    cli.table(guilds, {
        columns: [
            {key: 'name', label: 'Name' ,format: (name :string ) => cli.color.red(name)},
            {key: 'members', label:'Members', format: (members: string )=> cli.color.yellow(members)},
            {key: 'channels', label:'Channels',format: (channels: string )=> cli.color.blue(channels)},
        ]
    });
}



export function log(guild: Discord.Guild, message : String) : void {
    const logsChannel : Discord.GuildChannel = guild.channels.find('name', 'logs');
    if (!logsChannel){
        return debug.info(`Tried to log a message in ${guild.name} but a logs channel was not found.`);
    }
   if (logsChannel instanceof Discord.TextChannel){
        logsChannel.send('\`\`\`\n' + message + '\`\`\`');
        return debug.info(`Logged a message in ${guild.name}`);
   }
}