import { get, isEmpty, isNil, orderBy } from 'lodash';
import {v4 as uuidv4} from 'uuid';
import { isMainThread } from 'worker_threads';
import * as XRegExp from 'xregexp';
import { debug } from '../debug';
import Expects from '../expects';
import Message from '../message';
import { permission } from '../permissions';
import System from './_interface';

/*
 * !keyword                                     - gets an info about keyword usage
 * !keyword add -k [regexp] -r [response]       - add keyword with specified response
 * !keyword edit -k [uuid|regexp] -r [response] - edit keyword with specified response
 * !keyword remove -k [uuid|regexp]             - remove specified keyword
 * !keyword toggle -k [uuid|regexp]             - enable/disable specified keyword
 * !keyword list                                - get keywords list
 */

class Keywords extends System {
  constructor() {
    const options: InterfaceSettings = {
      settings: {
        commands: [
          { name: '!keyword', permission: permission.CASTERS },
          { name: '!keyword add', permission: permission.CASTERS },
          { name: '!keyword edit', permission: permission.CASTERS },
          { name: '!keyword list', permission: permission.CASTERS },
          { name: '!keyword remove', permission: permission.CASTERS },
          { name: '!keyword toggle', permission: permission.CASTERS },
        ],
        parsers: [
          { name: 'run', fireAndForget: true },
        ],
      },
    };
    super(options);

    this.addMenu({ category: 'manage', name: 'keywords', id: 'keywords/list' });
    if (isMainThread) {
      global.db.engine.index(this.collection.data, [{ index: 'id', unique: true }, { index: 'keyword' }]);
    }
  }

  public main(opts) {
    let url = 'http://sogehige.github.io/sogeBot/#/commands/keywords';
    if (get(process, 'env.npm_package_version', 'x.y.z-SNAPSHOT').includes('SNAPSHOT')) {
      url = 'http://sogehige.github.io/sogeBot/#/_master/commands/keywords';
    }
    global.commons.sendMessage(global.translate('core.usage') + ' => ' + url, opts.sender);
  }

  /**
   * Add new keyword
   *
   * format: !keyword add -k [regexp] -r [response]
   * @param {CommandOptions} opts - options
   * @return {Promise<Keyword | null>}
   */
  public async add(opts: CommandOptions): Promise<Keyword | null> {
    try {
      const [keywordRegex, response] =
        new Expects(opts.parameters)
          .argument({ name: 'k', optional: false, multi: true, delimiter: '' })
          .argument({ name: 'r', optional: false, multi: true, delimiter: '' })
          .toArray();
      const data: Keyword = {
        id: uuidv4(),
        keyword: keywordRegex,
        response,
        enabled: true,
      };
      await global.db.engine.insert(this.collection.data, data);
      global.commons.sendMessage(global.commons.prepare('keywords.keyword-was-added', data), opts.sender);
      return data;
    } catch (e) {
      global.commons.sendMessage(global.commons.prepare('keywords.keyword-parse-failed'), opts.sender);
      return null;
    }
  }

  /**
   * Edit keyword
   *
   * format: !keyword edit -k [uuid|regexp] -r [response]
   * @param {CommandOptions} opts - options
   * @return {Promise<Keyword | null>}
   */
  public async edit(opts: CommandOptions): Promise<Keyword | null> {
    try {
      const [keywordRegexOrUUID, response] =
        new Expects(opts.parameters)
          .argument({ name: 'k', optional: false, multi: true, delimiter: '' })
          .argument({ name: 'r', optional: false, multi: true, delimiter: '' })
          .toArray();

      let keywords: Keyword[] = [];
      if (global.commons.isUUID(keywordRegexOrUUID)) {
        keywords = await global.db.engine.find(this.collection.data, { id: keywordRegexOrUUID });
      } else {
        keywords = await global.db.engine.find(this.collection.data, { keyword: keywordRegexOrUUID });
      }

      if (keywords.length === 0) {
        global.commons.sendMessage(global.commons.prepare('keywords.keyword-was-not-found'), opts.sender);
        return null;
      } else if (keywords.length > 1) {
        global.commons.sendMessage(global.commons.prepare('keywords.keyword-is-ambiguous'), opts.sender);
        return null;
      } else {
        delete keywords[0]._id;
        keywords[0].response = response;
        await global.db.engine.update(this.collection.data, { id: keywords[0].id }, keywords[0]);
        global.commons.sendMessage(global.commons.prepare('keywords.keyword-was-edited', keywords[0]), opts.sender);
        return keywords[0];
      }
    } catch (e) {
      global.commons.sendMessage(global.commons.prepare('keywords.keyword-parse-failed'), opts.sender);
      return null;
    }
  }

  /**
   * Bot responds with list of keywords
   *
   * @param {CommandOptions} opts
   * @returns {Promise<void>}
   */
  public async list(opts: CommandOptions): Promise<void> {
    const keywords = orderBy(await global.db.engine.find(this.collection.data), 'keyword', 'asc');
    const list = keywords.map((o) => {
      return `${o.enabled ? '🗹' : '☐'} ${o.id} | ${o.keyword} | ${o.response}`;
    });

    let output;
    if (keywords.length === 0) {
      output = global.commons.prepare('keywords.list-is-empty');
    } else {
      output = global.commons.prepare('keywords.list-is-not-empty');
    }
    global.commons.sendMessage(output, opts.sender);

    for (let i = 0; i < list.length; i++) {
      setTimeout(() => {
        global.commons.sendMessage(list[i], opts.sender);
      }, 500 * i);
    }
  }

  /**
   * Parses message for keywords
   *
   * @param {ParserOptions} opts
   * @return true
   */
  public async run(opts: ParserOptions) {
    if (opts.message.trim().startsWith('!')) {
      return true;
    }

    const keywords = (await global.db.engine.find(this.collection.data)).filter((o) => {
      const isFoundInMessage = opts.message.search(new RegExp('\\b' + o.keyword + '\\b', 'gi')) >= 0;
      const isEnabled = o.enabled;
      debug('keywords.run', `\n\t<\t${opts.message}\n\t?\t${o.keyword}\n\t-\tisFoundInMessage: ${isFoundInMessage}, isEnabled: ${isEnabled}`);
      return isFoundInMessage && isEnabled;
    });

    for (const k of keywords) {
      const message = await (new Message(k.response).parse({ sender: opts.sender.username }));
      global.commons.sendMessage(message, opts.sender);
    }
    return true;
  }
/*

  async toggle(opts) {
    if (opts.parameters.trim().length === 0) {
      let message = await global.commons.prepare('keywords.keyword-parse-failed')
      global.commons.sendMessage(message, opts.sender)
      return false
    }
    let id = opts.parameters.trim()

    const keyword = await global.db.engine.findOne(this.collection.data, { keyword: id })
    if (isEmpty(keyword)) {
      let message = await global.commons.prepare('keywords.keyword-was-not-found', { keyword: id })
      global.commons.sendMessage(message, opts.sender)
      return
    }

    await global.db.engine.update(this.collection.data, { keyword: id }, { enabled: !keyword.enabled })

    let message = await global.commons.prepare(!keyword.enabled ? 'keywords.keyword-was-enabled' : 'keywords.keyword-was-disabled', { keyword: keyword.keyword })
    global.commons.sendMessage(message, opts.sender)
  }

  async remove(opts) {
    if (opts.parameters.trim().length === 0) {
      let message = await global.commons.prepare('keywords.keyword-parse-failed')
      global.commons.sendMessage(message, opts.sender)
      return false
    }
    let id = opts.parameters.trim()

    let removed = await global.db.engine.remove(this.collection.data, { keyword: id })
    if (!removed) {
      let message = await global.commons.prepare('keywords.keyword-was-not-found', { keyword: id })
      global.commons.sendMessage(message, opts.sender)
      return false
    }
    let message = await global.commons.prepare('keywords.keyword-was-removed', { keyword: id })
    global.commons.sendMessage(message, opts.sender)
  }
  */
}

export default new Keywords();
export { Keywords };
