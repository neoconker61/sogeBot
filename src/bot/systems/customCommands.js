// @flow

'use strict'

// 3rdparty libraries
const _ = require('lodash')
const XRegExp = require('xregexp')
const safeEval = require('safe-eval')
const commons = require('../commons');

// bot libraries
import { permission } from '../permissions';
import System from './_interface'
import constants from '../constants'
const Expects = require('../expects')

/*
 * !command                                                                 - gets an info about command usage
 * !command add (-p [uuid|name]) ?-s true|false ![cmd] [response]           - add command with specified response
 * !command edit (-p [uuid|name]) ?-s true|false ![cmd] [number] [response] - edit command with specified response
 * !command remove ![cmd]                                                   - remove specified command
 * !command remove ![cmd] [number]                                          - remove specified response of command
 * !command toggle ![cmd]                                                   - enable/disable specified command
 * !command toggle-visibility ![cmd]                                        - enable/disable specified command
 * !command list                                                            - get commands list
 * !command list ![cmd]                                                     - get responses of command
 */

type Response = {
  _id?: string,
  order: number,
  response: string,
  stopIfExecuted: boolean,
  permission: number,
  filter: string
}

type Command = {
  _id?: string,
  command: string,
  enabled: boolean,
  visible: boolean,
  responses?: Array<Response>,
  count?: number
}

class CustomCommands extends System {
  constructor () {
    const settings = {
      commands: [
        { name: '!command add', permission: permission.CASTERS },
        { name: '!command edit', permission: permission.CASTERS },
        { name: '!command list', permission: permission.CASTERS },
        { name: '!command remove', permission: permission.CASTERS },
        { name: '!command toggle-visibility', permission: permission.CASTERS },
        { name: '!command toggle', permission: permission.CASTERS },
        { name: '!command', permission: permission.CASTERS, isHelper: true }
      ],
      parsers: [
        { name: 'run', priority: constants.LOW, fireAndForget: true }
      ]
    }
    super({ settings })

    this.addMenu({ category: 'manage', name: 'customcommands', id: 'customcommands/list' })
  }

  sockets () {
    this.socket.on('connection', (socket) => {
      socket.on('find.commands', async (opts, cb) => {
        opts.collection = opts.collection || 'data'
        if (opts.collection.startsWith('_')) {
          opts.collection = opts.collection.replace('_', '')
        } else opts.collection = this.collection[opts.collection]

        opts.where = opts.where || {}

        let items: Array<Command> = await global.db.engine.find(opts.collection, opts.where)
        for (let i of items) {
          i.count = await this.getCountOf(i.command)
          i.responses = await global.db.engine.find(this.collection.responses, { cid: String(i._id) })
        }
        if (_.isFunction(cb)) cb(null, items)
      })
      socket.on('findOne.command', async (opts, cb) => {
        opts.collection = opts.collection || 'data'
        if (opts.collection.startsWith('_')) {
          opts.collection = opts.collection.replace('_', '')
        } else opts.collection = this.collection[opts.collection]

        opts.where = opts.where || {}

        let item: Command = await global.db.engine.findOne(opts.collection, opts.where)
        item.count = await this.getCountOf(item.command)
        item.responses = await global.db.engine.find(this.collection.responses, { cid: String(item._id) })
        if (_.isFunction(cb)) cb(null, item)
      })
      socket.on('update.command', async (opts, cb) => {
        opts.collection = opts.collection || 'data'
        if (opts.collection.startsWith('_')) {
          opts.collection = opts.collection.replace('_', '')
        } else opts.collection = this.collection[opts.collection]

        if (opts.items) {
          for (let item of opts.items) {
            const _id = item._id; delete item._id
            const count = item.count; delete item.count
            const responses = item.responses; delete item.responses

            let itemFromDb = item
            if (_.isNil(_id)) itemFromDb = await global.db.engine.insert(opts.collection, item)
            else await global.db.engine.update(opts.collection, { _id }, item)

            // set command count
            const cCount = await this.getCountOf(itemFromDb.command)
            if (count !== cCount && count === 0) {
              // we assume its always reset (set to 0)
              await global.db.engine.insert(this.collection.count, { command: itemFromDb.command, count: -cCount })
            }

            // update responses
            let rIds = []
            for (let r of responses) {
              if (!r.cid) r.cid = _id || String(itemFromDb._id)

              if (!r._id) {
                rIds.push(
                  String((await global.db.engine.insert(this.collection.responses, r))._id))
              } else {
                const _id = String(r._id); delete r._id
                rIds.push(_id)
                await global.db.engine.update(this.collection.responses, { _id }, r)
              }
            }

            itemFromDb._id = _id || String(itemFromDb._id)

            // remove responses
            for (let r of await global.db.engine.find(this.collection.responses, { cid: itemFromDb._id })) {
              if (!rIds.includes(String(r._id))) await global.db.engine.remove(this.collection.responses, { _id: String(r._id) })
            }

            if (_.isFunction(cb)) {
              cb(null, {
                command: itemFromDb,
                responses: await global.db.engine.find(this.collection.responses, { cid: itemFromDb._id })
              })
            }
          }
        } else {
          if (_.isFunction(cb)) cb(null, [])
        }
      })
    })
  }

  main (opts: Object) {
    commons.sendMessage(global.translate('core.usage') + ': !command add (-p [uuid|name]) (-s=true|false) <!cmd> <response> | !command edit (-p [uuid|name]) (-s=true|false) <!cmd> <number> <response> | !command remove <!command> | !command remove <!command> <number> | !command list | !command list <!command>', opts.sender)
  }

  async edit (opts: Object) {
    try {
      const [userlevel, stopIfExecuted, command, rId, response] = new Expects(opts.parameters)
        .permission({ optional: true, default: permission.VIEWERS })
        .argument({ optional: true, name: 's', default: null, type: Boolean })
        .argument({ name: 'c', type: String, multi: true, delimiter: '' })
        .argument({ name: 'rid', type: Number })
        .argument({ name: 'r', type: String, multi: true, delimiter: '' })
        .toArray()

      if (!command.startsWith('!')) {
        throw Error('Command should start with !')
      }

      let cDb = await global.db.engine.findOne(this.collection.data, { command })
      if (!cDb._id) return commons.sendMessage(commons.prepare('customcmds.command-was-not-found', { command }), opts.sender)

      let rDb = await global.db.engine.findOne(this.collection.responses, { cid: String(cDb._id), order: rId - 1 })
      if (!rDb._id) return commons.sendMessage(commons.prepare('customcmds.response-was-not-found', { command, response: rId }), opts.sender)


      const pItem: Permissions.Item | null = await global.permissions.get(userlevel);
      if (!pItem) {
        throw Error('Permission ' + perm + ' not found.');
      }

      const _id = rDb._id; delete rDb._id
      rDb.response = response
      rDb.permission = pItem.id
      if (stopIfExecuted) rDb.stopIfExecuted = stopIfExecuted

      await global.db.engine.update(this.collection.responses, { _id }, rDb)
      commons.sendMessage(commons.prepare('customcmds.command-was-edited', { command, response }), opts.sender)
    } catch (e) {
      commons.sendMessage(commons.prepare('customcmds.commands-parse-failed'), opts.sender)
    }
  }

  async add (opts: Object) {
    try {
      const [userlevel, stopIfExecuted, command, response] = new Expects(opts.parameters)
        .permission({ optional: true, default: permission.VIEWERS })
        .argument({ optional: true, name: 's', default: false, type: Boolean })
        .argument({ name: 'c', type: String, multi: true, delimiter: '' })
        .argument({ name: 'r', type: String, multi: true, delimiter: '' })
        .toArray()

      if (!command.startsWith('!')) {
        throw Error('Command should start with !')
      }

      let cDb = await global.db.engine.findOne(this.collection.data, { command })
      if (!cDb._id) {
        cDb = await global.db.engine.insert(this.collection.data, {
          command, enabled: true, visible: true
        })
      }

      const pItem: Permissions.Item | null = await global.permissions.get(userlevel);
      if (!pItem) {
        throw Error('Permission ' + perm + ' not found.');
      }

      let rDb = await global.db.engine.find(this.collection.responses, { cid: String(cDb._id) })
      await global.db.engine.insert(this.collection.responses, {
        cid: String(cDb._id),
        order: rDb.length,
        permission: pItem.id,
        stopIfExecuted,
        response
      })
      commons.sendMessage(commons.prepare('customcmds.command-was-added', { command }), opts.sender)
    } catch (e) {
      commons.sendMessage(commons.prepare('customcmds.commands-parse-failed'), opts.sender)
    }
  }

  async run (opts: Object) {
    if (!opts.message.startsWith('!')) return true // do nothing if it is not a command

    let _responses = []
    var command: $Shape<Command> = {} // eslint-disable-line no-undef
    let cmdArray = opts.message.toLowerCase().split(' ')
    for (let i = 0, len = opts.message.toLowerCase().split(' ').length; i < len; i++) {
      command = await global.db.engine.findOne(this.collection.data, { command: cmdArray.join(' '), enabled: true })
      if (!_.isEmpty(command)) break
      cmdArray.pop() // remove last array item if not found
    }
    if (Object.keys(command).length === 0) return true // no command was found - return

    // remove found command from message to get param
    const param = opts.message.replace(new RegExp('^(' + cmdArray.join(' ') + ')', 'i'), '').trim()
    global.db.engine.increment(this.collection.count, { command: command.command }, { count: 1 })

    const responses: Array<Response> = await global.db.engine.find(this.collection.responses, { cid: String(command._id) })
    for (let r of _.orderBy(responses, 'order', 'asc')) {
      if ((await global.permissions.check(opts.sender.userId, r.permission)).access
          && await this.checkFilter(opts, r.filter)) {
        _responses.push(r)
      }
    }

    this.sendResponse(_.cloneDeep(_responses), { param, sender: opts.sender, command: command.command });
    return _responses.map((o) => {
      return o.response
    })
  }

  async sendResponse(responses, opts) {
    if (responses.length === 0) return;
    const response = responses.shift()
    await commons.sendMessage(response.response, opts.sender, {
      param: opts.param,
      cmd: opts.command
    })
    setTimeout(() => {
      this.sendResponse(responses, opts);
    }, 300)
  }

  async list (opts: Object) {
    const command = new Expects(opts.parameters).command({ optional: true }).toArray()[0]

    if (!command) {
      // print commands
      let commands = await global.db.engine.find(this.collection.data, { visible: true, enabled: true })
      var output = (commands.length === 0 ? global.translate('customcmds.list-is-empty') : global.translate('customcmds.list-is-not-empty').replace(/\$list/g, _.map(_.orderBy(commands, 'command'), 'command').join(', ')))
      commons.sendMessage(output, opts.sender)
    } else {
      // print responses
      const cid = String((await global.db.engine.findOne(this.collection.data, { command }))._id)
      const responses = _.orderBy((await global.db.engine.find(this.collection.responses, { cid })), 'order', 'asc')

      if (responses.length === 0) commons.sendMessage(commons.prepare('customcmdustomcmds.list-of-responses-is-empty', { command }), opts.sender)
      let permissions = (await global.db.engine.find(global.permissions.collection.data)).map((o) => {
        return {
          v: o.id, string: o.name
        }
      })
      for (let r of responses) {
        let rPrmsn: any = permissions.find(o => o.v === r.permission)
        const response = await commons.prepare('customcmds.response', { command, index: ++r.order, response: r.response, after: r.stopIfExecuted ? '_' : 'v', permission: rPrmsn.string })
        global.log.chatOut(response, { username: opts.sender.username })
        commons.message(global.tmi.settings.chat.sendWithMe ? 'me' : 'say', commons.getOwner(), response)
      }
    }
  }

  async togglePermission (opts: Object) {
    const command = await global.db.engine.findOne(this.collection.data, { command: opts.parameters })
    if (!_.isEmpty(command)) {
      await global.db.engine.update(this.collection.data, { _id: command._id.toString() }, { permission: command.permission === 3 ? 0 : ++command.permission })
    }
  }

  async toggle (opts: Object) {
    const match = XRegExp.exec(opts.parameters, constants.COMMAND_REGEXP)
    if (_.isNil(match)) {
      let message = await commons.prepare('customcmds.commands-parse-failed')
      commons.sendMessage(message, opts.sender)
      return false
    }

    const command = await global.db.engine.findOne(this.collection.data, { command: match.command })
    if (_.isEmpty(command)) {
      let message = await commons.prepare('customcmds.command-was-not-found', { command: match.command })
      commons.sendMessage(message, opts.sender)
      return false
    }

    await global.db.engine.update(this.collection.data, { command: match.command }, { enabled: !command.enabled })

    let message = await commons.prepare(!command.enabled ? 'customcmds.command-was-enabled' : 'customcmds.command-was-disabled', { command: command.command })
    commons.sendMessage(message, opts.sender)
  }

  async toggleVisibility (opts: Object) {
    const match = XRegExp.exec(opts.parameters, constants.COMMAND_REGEXP)
    if (_.isNil(match)) {
      let message = await commons.prepare('customcmds.commands-parse-failed')
      commons.sendMessage(message, opts.sender)
      return false
    }

    const command = await global.db.engine.findOne(this.collection.data, { command: match.command })
    if (_.isEmpty(command)) {
      let message = await commons.prepare('customcmds.command-was-not-found', { command: match.command })
      commons.sendMessage(message, opts.sender)
      return false
    }

    await global.db.engine.update(this.collection.data, { command: match.command }, { visible: !command.visible })
    let message = await commons.prepare(!command.visible ? 'customcmds.command-was-exposed' : 'customcmds.command-was-concealed', { command: command.command })
    commons.sendMessage(message, opts.sender)
  }

  async remove (opts: Object) {
    try {
      const [command, response] = new Expects(opts.parameters).command().number({ optional: true }).toArray()
      let cid = (await global.db.engine.findOne(this.collection.data, { command }))._id
      if (!cid) {
        commons.sendMessage(commons.prepare('customcmds.command-was-not-found', { command }), opts.sender)
      } else {
        cid = String(cid)
        if (response) {
          const order = Number(response) - 1
          let removed = await global.db.engine.remove(this.collection.responses, { cid, order })
          if (removed > 0) {
            commons.sendMessage(commons.prepare('customcmds.response-was-removed', { command, response }), opts.sender)

            // update order
            const responses = _.orderBy(await global.db.engine.find(this.collection.responses, { cid }), 'order', 'asc')
            if (responses.length === 0) {
              // remove command if 0 responses
              await global.db.engine.remove(this.collection.data, { command })
            }

            let order = 0
            for (let r of responses) {
              const _id = String(r._id); delete r._id
              r.order = order
              await global.db.engine.update(this.collection.responses, { _id }, r)
              order++
            }
          } else commons.sendMessage(commons.prepare('customcmds.response-was-not-found', { command, response }), opts.sender)
        } else {
          await global.db.engine.remove(this.collection.data, { command })
          commons.sendMessage(commons.prepare('customcmds.command-was-removed', { command }), opts.sender)
        }
      }
    } catch (e) {
      return commons.sendMessage(commons.prepare('customcmds.commands-parse-failed'), opts.sender)
    }
  }

  async getCountOf (command: string) {
    let count = 0
    for (let item of await global.db.engine.find(this.collection.count, { command })) {
      let toAdd = !_.isNaN(parseInt(_.get(item, 'count', 0))) ? _.get(item, 'count', 0) : 0
      count = count + Number(toAdd)
    }
    if (Number(count) < 0) count = 0

    return parseInt(
      Number(count) <= Number.MAX_SAFE_INTEGER
        ? count
        : Number.MAX_SAFE_INTEGER, 10)
  }

  async checkFilter (opts: Object, filter: string) {
    if (typeof filter === 'undefined' || filter.trim().length === 0) return true
    let toEval = `(function evaluation () { return ${filter} })()`

    let $userObject = await global.users.getByName(opts.sender.username)
    let $rank = null
    if (global.systems.ranks.isEnabled()) {
      $rank = await global.systems.ranks.get($userObject)
    }

    const $is = {
      moderator: await commons.isModerator(opts.sender.username),
      subscriber: await commons.isSubscriber(opts.sender.username),
      vip: await commons.isVIP(opts.sender.username),
      broadcaster: commons.isBroadcaster(opts.sender.username),
      bot: commons.isBot(opts.sender.username),
      owner: commons.isOwner(opts.sender.username),
    }

    const context = {
      _: _,
      $sender: opts.sender.username,
      $is,
      $rank,
      // add global variables
      $game: _.get(await global.db.engine.findOne('api.current', { key: 'game' }), 'value', 'n/a'),
      $title: _.get(await global.db.engine.findOne('api.current', { key: 'title' }), 'value', 'n/a'),
      $views: _.get(await global.db.engine.findOne('api.current', { key: 'views' }), 'value', 0),
      $followers: _.get(await global.db.engine.findOne('api.current', { key: 'followers' }), 'value', 0),
      $hosts: _.get(await global.db.engine.findOne('api.current', { key: 'hosts' }), 'value', 0),
      $subscribers: _.get(await global.db.engine.findOne('api.current', { key: 'subscribers' }), 'value', 0)
    }
    var result = false
    try {
      result = safeEval(toEval, context)
    } catch (e) {
      // do nothing
    }
    delete context._
    return !!result // force boolean
  }
}

module.exports = new CustomCommands()
