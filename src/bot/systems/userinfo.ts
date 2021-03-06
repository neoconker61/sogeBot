import _ from 'lodash';
import { DateTime } from 'luxon';

import { getLocalizedName, prepare, sendMessage } from '../commons';
import System from './_interface';

/*
 * !me
 * !lastseen
 * !watched
 * !followage
 * !subage
 * !age
 */

class UserInfo extends System {
  constructor() {
    const options: InterfaceSettings = {
      ui: {
        me: {
          format: {
            type: 'sortable-list',
            values: '_order',
            toggle: '_formatDisabled',
            toggleOnIcon: 'fa-eye',
            toggleOffIcon: 'fa-eye-slash',
          },
        },
      },
      settings: {
        me: {
          _order: ['$sender', '$rank', '$watched', '$points', '$messages', '$tips'],
          _formatDisabled: [],
          formatSeparator: ' | ',
        },
        commands: [
          { name: '!me', fnc: 'showMe' },
          { name: '!lastseen', fnc: 'lastseen' },
          { name: '!watched', fnc: 'watched' },
          { name: '!followage', fnc: 'followage' },
          { name: '!subage', fnc: 'subage' },
          { name: '!age', fnc: 'age' },
        ],
      },
      on: {
        message: (e) => this.onMessage(e),
      },
    };
    super(options);
  }

  protected async followage(opts: CommandOptions) {
    let username;
    const parsed = opts.parameters.match(/([^@]\S*)/g);

    if (_.isNil(parsed)) {
      username = opts.sender.username;
    } else {
      username = parsed[0].toLowerCase();
    }

    const user = await global.users.getByName(username);
    if (_.isNil(user) || _.isNil(user.time) || _.isNil(user.time.follow) || _.isNil(user.is.follower) || !user.is.follower) {
      sendMessage(prepare('followage.' + (opts.sender.username === username.toLowerCase() ? 'successSameUsername' : 'success') + '.never', { username }), opts.sender);
    } else {
      const units: string[] = ['years', 'months', 'days', 'hours', 'minutes'];
      const diff = DateTime.fromMillis(user.time.follow).diffNow(['years', 'months', 'days', 'hours', 'minutes']);
      const output: string[] = [];
      for (const unit of units) {
        if (diff[unit]) {
          const v = -Number(diff[unit]).toFixed();
          output.push(v + ' ' + getLocalizedName(v, 'core.' + unit));
        }
      }
      if (output.length === 0) {
        output.push(0 + ' ' + getLocalizedName(0, 'core.minutes'));
      }

      sendMessage(prepare('followage.' + (opts.sender.username === username.toLowerCase() ? 'successSameUsername' : 'success') + '.time', {
          username,
          diff: output.join(', '),
        }), opts.sender);
    }
  }

  protected async subage(opts: CommandOptions) {
    let username;
    const parsed = opts.parameters.match(/([^@]\S*)/g);

    if (_.isNil(parsed)) {
      username = opts.sender.username;
    } else {
      username = parsed[0].toLowerCase();
    }

    const user = await global.users.getByName(username);
    if (_.isNil(user) || _.isNil(user.time) || _.isNil(user.time.subscribed_at) || _.isNil(user.is.subscriber) || !user.is.subscriber) {
      sendMessage(prepare('subage.' + (opts.sender.username === username.toLowerCase() ? 'successSameUsername' : 'success') + '.never', { username }), opts.sender);
    } else {
      const units: string[] = ['years', 'months', 'days', 'hours', 'minutes'];
      const diff = DateTime.fromMillis(user.time.subscribed_at).diffNow(['years', 'months', 'days', 'hours', 'minutes']);
      const output: string[] = [];
      for (const unit of units) {
        if (diff[unit]) {
          const v = -Number(diff[unit]).toFixed();
          output.push(v + ' ' + getLocalizedName(v, 'core.' + unit));
        }
      }
      if (output.length === 0) {
        output.push(0 + ' ' + getLocalizedName(0, 'core.minutes'));
      }

      sendMessage(prepare('subage.' + (opts.sender.username === username.toLowerCase() ? 'successSameUsername' : 'success') + '.time', {
          username,
          diff: output.join(', '),
        }), opts.sender);
    }
  }

  protected async age(opts: CommandOptions) {
    let username;
    const parsed = opts.parameters.match(/([^@]\S*)/g);

    if (_.isNil(parsed)) {
      username = opts.sender.username;
    } else {
      username = parsed[0].toLowerCase();
    }

    const user = await global.users.getByName(username);
    if (_.isNil(user) || _.isNil(user.time) || _.isNil(user.time.created_at)) {
      sendMessage(prepare('age.failed', { username }), opts.sender);
    } else {
      const units: string[] = ['years', 'months', 'days', 'hours', 'minutes'];
      const diff = DateTime.fromMillis(new Date(user.time.created_at).getTime()).diffNow(['years', 'months', 'days', 'hours', 'minutes']);
      const output: string[] = [];
      for (const unit of units) {
        if (diff[unit]) {
          const v = -Number(diff[unit]).toFixed();
          output.push(v + ' ' + getLocalizedName(v, 'core.' + unit));
        }
      }
      if (output.length === 0) {
        output.push(0 + ' ' + getLocalizedName(0, 'core.minutes'));
      }
      sendMessage(prepare('age.success.' + (opts.sender.username === username.toLowerCase() ? 'withoutUsername' : 'withUsername'), {
          username,
          diff: output.join(', '),
        }), opts.sender);
    }
  }

  protected async lastseen(opts: CommandOptions) {
    try {
      const parsed = opts.parameters.match(/^([\S]+)$/);
      if (parsed === null) {
        throw new Error();
      }

      const user = await global.users.getByName(parsed[0]);
      if (_.isNil(user) || _.isNil(user.time) || _.isNil(user.time.message)) {
        sendMessage(global.translate('lastseen.success.never').replace(/\$username/g, parsed[0]), opts.sender);
      } else {
        const when = DateTime.fromMillis(user.time.message, { locale: global.general.settings.lang});
        sendMessage(global.translate('lastseen.success.time')
          .replace(/\$username/g, parsed[0])
          .replace(/\$when/g, when.toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS)), opts.sender);
      }
    } catch (e) {
      sendMessage(global.translate('lastseen.failed.parse'), opts.sender);
    }
  }

  protected async watched(opts: CommandOptions) {
    try {
      const parsed = opts.parameters.match(/^([\S]+)$/);

      let id = opts.sender.userId;
      let username = opts.sender.username;

      if (parsed) {
        username = parsed[0].toLowerCase();
        id = await global.users.getIdByName(username);
      }
      const time = id ? Number((await global.users.getWatchedOf(id) / (60 * 60 * 1000))).toFixed(1) : 0;
      sendMessage(prepare('watched.success.time', { time: String(time), username }), opts.sender);
    } catch (e) {
      sendMessage(global.translate('watched.failed.parse'), opts.sender);
    }
  }

  protected async showMe(opts: CommandOptions) {
    try {
      const message: string[] = [];

      // build message
      for (const i of this.settings.me._order) {
        if (!this.settings.me._formatDisabled.includes(i)) {
          message.push(i);
        }
      }

      if (message.includes('$rank')) {
        const idx = message.indexOf('$rank');
        const rank = await global.systems.ranks.get(opts.sender.username);
        if (await global.systems.ranks.isEnabled() && !_.isNull(rank)) {
          message[idx] = rank;
        } else {
          message.splice(idx, 1);
        }
      }

      if (message.includes('$watched')) {
        const watched = await global.users.getWatchedOf(opts.sender.userId);
        const idx = message.indexOf('$watched');
        message[idx] = (watched / 1000 / 60 / 60).toFixed(1) + 'h';
      }

      if (message.includes('$points')) {
        const idx = message.indexOf('$points');
        if (await global.systems.points.isEnabled()) {
          const userPoints = await global.systems.points.getPointsOf(opts.sender.userId);
          message[idx] = userPoints + ' ' + await global.systems.points.getPointsName(userPoints);
        } else {
          message.splice(idx, 1);
        }
      }

      if (message.includes('$messages')) {
        const messages = await global.users.getMessagesOf(opts.sender.userId);
        const idx = message.indexOf('$messages');
        message[idx] = messages + ' ' + getLocalizedName(messages, 'core.messages');
      }

      if (message.includes('$tips')) {
        const idx = message.indexOf('$tips');
        const tips = await global.db.engine.find('users.tips', { id: opts.sender.userId });
        const currency = global.currency.settings.currency.mainCurrency;
        let tipAmount = 0;
        for (const t of tips) {
          tipAmount += global.currency.exchange(t.amount, t.currency, currency);
        }
        message[idx] = `${Number(tipAmount).toFixed(2)}${global.currency.symbol(currency)}`;
      }
      sendMessage(message.join(this.settings.me.formatSeparator), opts.sender);
    } catch (e) {
      global.log.error(e.stack);
    }
  }

  private onMessage(opts: onEventMessage) {
    if (!_.isNil(opts.sender) && !_.isNil(opts.sender.userId) && !_.isNil(opts.sender.username)) {
      global.users.setById(opts.sender.userId, {
        username: opts.sender.username,
        time: { message: new Date().getTime() },
        is: { subscriber: typeof opts.sender.badges.subscriber !== 'undefined' },
      }, true);
      global.db.engine.update('users.online', { username: opts.sender.username }, { username: opts.sender.username });
    }
  }
}

module.exports = new UserInfo();
