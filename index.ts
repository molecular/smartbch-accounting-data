import { config } from "./config";
import config_contracts from "./assets/config/contract.json";
import contract_abis from "./assets/config/contract-abi.json";

import Web3 from "web3";
import { NodeApiService } from './services/api/node-api.service';

import { Block, Transaction } from 'web3-eth';
import { Log, BlockNumber } from 'web3-core';

import { UtilHelperService } from './services/helpers/util-helper.service'
import { EventDecoder, IDecodedValue } from './services/helpers/event-decoder';

import { createWriteStream } from 'fs';
import { stringify } from 'csv-stringify';
import { BigNumber } from 'bignumber.js';

const util = new UtilHelperService();
const api = new NodeApiService(config.api);

// configure BigNumber classes (here and in util module)
const bignumberConfig: BigNumber.Config = {
	ROUNDING_MODE: BigNumber.ROUND_DOWN,
	DECIMAL_PLACES: 18,
	EXPONENTIAL_AT: [-50,50]
};
BigNumber.config(bignumberConfig);
util.bignumberConfig(bignumberConfig); // TODO: not sure this works

api.getBlockHeader().then(async (latest) => {
	console.log(`latest block Number: ${latest}, ${"0x" + (latest - 10).toString(16)}`)
	const blocks_per_second = 5;
	//const blocks = 30*24*60*60 / blocks_per_second;

	const start_block = 
		"0x1";
		//util.toHex(latest-blocks);

	const end_block = util.toHex(latest+1);

	const max_count = "0x0"; // 0x0 == no limit

	// list of topics to query events for
	let topics: string[][] = [
		["0xd1ac89bfc464ce49c894c4e2379f1ca2b062aff1a640e929764ac1157fa13f0f"], // flexUSD.ChangeMultiplier topic
	];
	// append my_addresses from config
	topics = topics.concat(config.my_addresses.map((a) => [util.convertAddressToTopic(a)]));

	let contract_names: string[] = [
		"flexUSD",
		"Mist",
    //"MIST Router",
    //"MIST MasterChef",
    //"MISTbar",
	]
	let contracts = config_contracts.filter(c => contract_names.includes(c.name));

	// extend contracts with values from some method calls (decimals())
	var methods = [
		{name: "decimals", return_type: 'uint8'},
		{name: "symbol", return_type: 'string'},
	];
	Promise.all(methods.map((method) => {
		let call_string = method.name + "()";
		return Promise.all(contracts.map((contract) => {
			return api.call(
				{
					to: contract.address,
					data: "" + Web3.utils.sha3(call_string)
				}, method.return_type
			)
			.then((result) => {
				contract[call_string] = result;
				return contract;
			});
		}))
	}));

	// process and aggregate queryLogs results for each combination of contract and topic
	Promise.all(contracts.map((contract) => {
		return Promise.all(topics.map((topic) => {
			return api.queryLogs(
				contract.address,
				topic,
				start_block, end_block, max_count
			)
		}))
		.then(flattenArrays)
		.then((logs: Log[]) => decodeLogsToEvents(contract, logs))
		.then(extendEventsWithBlockInfo)
		.then((events: any[]) => appendSyntheticEvents(contract, events))
		.then((events: any[]) => convertValues(contract, events))
	}))
	.then(flattenArrays)
	.then(groupEventsByName)
	.then(dumpEventsToCSV);

});

function flattenArrays<T>(arrays: T[][]): T[] {
	return arrays.reduce((o, i) => { return o.concat(i); }, [])
}

function logResults(result: any) {
	console.log(result);
	return result;
}

function decodeLogsToEvents(contract, logs: Log[]): any[] {
	let rc: any[] = [];
	contract_abis.filter(abi => contract.abiNames.map((n) => { return n.toLowerCase(); }).includes(abi.type.toLowerCase())).
	forEach((contract_abi) => {
		let event_decoder = new EventDecoder(contract_abi.abi);

		let events = logs.map((log) => {
			let dlog = event_decoder.decodeLog(log);
			if (!dlog || dlog.name === undefined) {
				console.log("unable to decode log:", log);
				if (dlog) 
					console.log("unable to decode dlog:", dlog);
			}
			//assert.equal(log.address, contract.address);
			if (dlog) {
				let parameters = dlog.events.reduce((o, e: IDecodedValue) => {
					o[`${e.name}(${e.type})`] = e.value;
					return o;
				}, {});
				return {
					blockNumber: util.parseHex(""+log.blockNumber),
					abi: contract_abi.type,
					event_name: dlog.name,
					contract_address: log.address,
					contract_name: contract.name,
					contract_symbol: contract["symbol()"],
					...parameters
				}
			}
		});
		rc = rc.concat(events);
	});
	return rc;
}

// look up blocks to set blockTimestamp, blockDate on each transfer
function extendEventsWithBlockInfo(events: any[]): Promise<any[]> {		
	let blockNumbers: BlockNumber[] = events.map((t) => { 
		if (t) return t.blockNumber; 
		return 0
	});
	return api.getBlocks(blockNumbers)
	.then((blocks: Block[]) => {
		let blocks_by_number = blocks.reduce((o, block) => {
			o[block.number] = block;
			return o;
		},{});

		// extend event with block info
		return events.map((event) => {
			if (event && event.blockNumber) {
				let block = blocks_by_number[event.blockNumber]
				return {
					blockTimestamp: block.timestamp,
					blockDate: new Date(1000 * parseInt(""+block.timestamp)).toISOString(),
					...event,
				};
			} else {
				return {
					blockTimestamp: -1,
					blockDate: "",
					...event,
				};
			}
		});
	});
}

// create synthetic events from existing events like flexUSD interest payments from ChangeMultiplier events
function appendSyntheticEvents(contract, events: any[]) {

	// setup balance tracking
	let balance_by_address = config.my_addresses.reduce((o,a) => {
		o[a] = new BigNumber(0.0);
		return o;
	}, {});
	//console.log("balances", balance_by_address);

	// iterate through events in chronological order tracking balance and generating <synthetic> events
	let previousMultiplier = new BigNumber(`1E${contract["decimals()"]}`);
	let created_events: any[] = [];
	let relevant_events = 
	events
	.filter((event) => {
		return event["contract_name"] == contract.name && ["ChangeMultiplier", "Transfer"].includes(event["event_name"])
	})
	.sort((a,b) => {
		return a.blockTimestamp - b.blockTimestamp
	})
	.forEach((event) => {
		//console.log(event);
		if (event["event_name"] == "Transfer") {
			config.my_addresses.forEach((address) => {
				//console.log("address", address, "to", event["to(address)"], "value", event["value(uint256)"])
				if (address.toLowerCase() == event["from(address)"].toLowerCase()) {
					balance_by_address[address] = balance_by_address[address].integerValue().minus(new BigNumber(event["value(uint256)"]).integerValue());
					event["<balance>(uint256)"] = balance_by_address[address]
				}
				if (address.toLowerCase() == event["to(address)"].toLowerCase()) {
					balance_by_address[address] = balance_by_address[address].integerValue().plus(new BigNumber(event["value(uint256)"]).integerValue());
					event["<balance>(uint256)"] = balance_by_address[address]
				}
			})
		}
		if (event["event_name"] == "ChangeMultiplier") {
			let multiplier = new BigNumber(event["multiplier(uint256)"])

			config.my_addresses.forEach((a) => {
				let new_balance = balance_by_address[a].multipliedBy(multiplier).dividedBy(previousMultiplier).integerValue();
				let delta = new_balance.minus(balance_by_address[a])
				if (!delta.isEqualTo(0)) {
					created_events.push({
						blockTimestamp: event.blockTimestamp,
						blockDate: event.blockDate,
						blockNumber: event.blockNumber,
						abi: '<synthetic, interest payment>',
						event_name: 'Transfer',
						contract_address: event.contract_address,
						contract_name: event.contract_name,
						contract_symbol: event.contract_symbol,
						"from(address)": "",
						"to(address)": a,
						"value(uint256)": delta,
						"<balance>(uint256)": new_balance
					});
					balance_by_address[a] = new_balance;
				}
			})

			previousMultiplier = multiplier;
		}
	});
	// config.my_addresses.forEach((a) => {
	// 	console.log(a, ": ", balance_by_address[a].dividedBy(1E18).toFixed(18));
	// })
	return events.concat(created_events).sort((a,b) => {
		return a.blockTimestamp - b.blockTimestamp
	});
}

function convertValues(contract, events): Promise<any[]> {
	events.forEach((event) => {
		Object.keys(event).forEach((key) => {
			if (key.indexOf("(uint256)") > 0) {
				if (event[key] !== undefined ) {
					event[key+"_"] = new BigNumber(event[key]).integerValue().dividedBy(new BigNumber(`1e${contract["decimals()"]}`)).toFixed(config.output.decimals)
					event[key] = new BigNumber(event[key]).integerValue()
				}
			}
		});
	});
	return events;
}

function groupEventsByName(events: any[]): Promise<any> {
	// group eventy by their types
	let events_by_name = events.reduce((o, event) => {
		let key = 
			// event["abi"] + "." + event["event_name"] // enable when "abiNames": ["FlexUSDImplV2","sep20"] (in contract.json) woreks
			event["event_name"]
		if (!o[key]) o[key] = [];
		o[key].push(event);
		return o;
	}, {});
	return events_by_name;
}

function dumpEventsToCSV(events_by_name) {

	// dump events of each event name to "<event_name>.csv"
	Object.keys(events_by_name).forEach((event_name) => {
		let events = events_by_name[event_name];  
		let filename = event_name + ".csv";
		stringify(events, { 
			header: true,
			columns: Object.keys(events[0])
		})
		.pipe(createWriteStream(filename));
		console.log(`wrote ${filename}: ${events.length} ${event_name}-events`);
	})

}
//     queryLogs(address: string, data: any[], start: string | 'latest', end: string | 'latest', limit: string): Promise<any>;
