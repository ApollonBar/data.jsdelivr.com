const crypto = require('crypto');
const BaseModel = require('./BaseModel');

class BaseCacheModel extends BaseModel {
	static async flushCache () {
		return redis.flushdbAsync().catch(() => {});
	}

	static get (transformKey = '', expiration = 24 * 60 * 60, deserialize = v => v) {
		return this.transform(transformKey, v => v, expiration, deserialize);
	}

	static getOne (transformKey = '', callback = async v => v, expiration = 24 * 60 * 60) {
		return this.transform(transformKey, callback, expiration, v => this.fromJson(v));
	}

	static getMany (transformKey = '', callback = async v => v, expiration = 24 * 60 * 60) {
		return this.transform(transformKey, callback, expiration, a => a.map(v => this.fromJson(v)));
	}

	static transform (transformKey, callback, expiration = 24 * 60 * 60, deserialize = v => v) {
		return new Proxy(new ProxyTarget(this, transformKey, callback, expiration, deserialize), BaseCacheModel.ProxyTargetHandler);
	}

	/**
	 * @returns {Promise<number>}
	 */
	async delete () {
		let result = await super.delete();
		await this.constructor.flushCache();
		return result;
	}

	/**
	 * @returns {Promise<this>}
	 */
	async insert () {
		let result = await super.insert();
		await this.constructor.flushCache();
		return result;
	}

	/**
	 * @returns {Promise<number>}
	 */
	async update () {
		let result = await super.update();
		await this.constructor.flushCache();
		return result;
	}
}

class ProxyTarget {
	constructor (model, transformKey, callback, expiration, deserialize) {
		this.model = model;
		this.transformKey = transformKey;
		this.callback = callback;
		this.expiration = expiration;
		this.deserialize = deserialize;
	}

	static hash (...values) {
		let normalized = values.map((value) => {
			if (value instanceof Date) {
				return value.valueOf();
			} else if (typeof value !== 'function' && _.isObject(value)) {
				return JSON.stringify(_.map(Object.keys(value).sort(), key => value[key]));
			}

			return String(value);
		}).join(':');

		return crypto.createHash('sha256').update(normalized).digest('base64');
	}
}

module.exports = BaseCacheModel;
module.exports.ProxyHandler = BaseModel.ProxyHandler;
module.exports.ProxyTargetHandler = _.defaults({
	get (target, property) {
		if (typeof target.model[property] === 'function') {
			return async (...args) => {
				let key = `${target.model.name}:${property}:${ProxyTarget.hash(...args)}:${target.transformKey}`, value;

				if (value = await redis.getCompressedAsync(key).catch(() => {})) {
					return target.deserialize(JSON.parse(value));
				}

				value = await target.callback(await target.model[property](...args));

				if (value) {
					redis.setCompressedAsync(key, JSON.stringify(value), 'EX', target.expiration).catch(() => {});
				}

				return value;
			};
		}
	},
}, BaseModel.ProxyHandler);
