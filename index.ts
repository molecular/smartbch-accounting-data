import { config } from "./config";
import contract_abis from "./assets/config/contract-abi.json";

import Web3 from "web3";
// import { BlockNumber, Log, TransactionConfig, TransactionReceipt } from 'web3-core';
// import { Block, Transaction } from 'web3-eth';

//import { Transaction } from 'web3-eth';
import { Log, BlockNumber, TransactionConfig } from 'web3-core';

import { UtilHelperService } from './services/helpers/util-helper.service'
import { EventDecoder, IDecodedValue } from './services/helpers/event-decoder';

import { createWriteStream, createReadStream } from 'fs';
import { stringify } from 'csv-stringify';
import { parse } from 'csv-parse';
import { BigNumber } from 'bignumber.js';

import { Contract, ContractManager } from './contractmanager'
import { SmartBCHApi } from './smartbch_api'

const util = new UtilHelperService();
const sbch = new SmartBCHApi(config.api.apiEndpoint);
const contract_manager = new ContractManager(sbch);

// configure BigNumber classes (here and in util module)
const bignumberConfig: BigNumber.Config = {
	ROUNDING_MODE: BigNumber.ROUND_DOWN,
	DECIMAL_PLACES: 18,
	EXPONENTIAL_AT: [-50,50]
};
BigNumber.config(bignumberConfig);
util.bignumberConfig(bignumberConfig); // TODO: not sure this works


sbch.blockNumber().then(async (latest: string) => {

	let height = util.parseHex(latest)
	console.log(`latest block Number: ${latest}, type: ${typeof latest}`)
	const blocks_per_second = 5;
	//const blocks = 30*24*60*60 / blocks_per_second;

	const start_block = 
		1;
		//height-blocks;

	const end_block = 
		height+1;
		//1090000;

	const max_count = 0; // 0: default limit

	//do_1_transactions(start_block, end_block, max_count)
	do_2_ethGetLogs(start_block, end_block, max_count);

});

const range = (start, end) => Array.from(Array(end - start + 1).keys()).map(x => x + start);

function do_1_transactions(start_block, end_block, max_count) {
	Promise.all(config.my_addresses.map((address) => {
		return sbch.queryTxByAddr(address, start_block, util.toHex(end_block), util.toHex(max_count))
	}))
	.then(logResults)
}

function do_2_ethGetLogs(start_block, end_block, max_count) {
	// append my_addresses from config
	let my_address_topics = config.my_addresses.map((address) => util.convertAddressToTopic(address));
	let sets = [
		{ contract_address: "0x7b2B3C5308ab5b2a1d9a94d20D35CCDf61e05b72", topics: [Web3.utils.sha3("ChangeMultiplier(uint256)")] },
		{ contract_address: null, topics: [null, my_address_topics] },
		{ contract_address: null, topics: [null, null, my_address_topics] },
		{ contract_address: null, topics: [null, null, null, my_address_topics] },
	]

	Promise.all(sets.map((set) => {
		return sbch.getLogs(set.contract_address, set.topics, util.toHex(start_block), util.toHex(end_block))
	}))
	.then(flattenArrays)
//	.then(logToConsole)
	.then((logs) => {
		return contract_manager.loadContracts(logs.map(log => log.address))
		.then(() => { return logs; });
	})
	// .then((events) => {
	// 	return events.filter((event) => event.address == '0x674a71e69fe8d5ccff6fdcf9f1fa4262aa14b154');
	// })
	.then(decodeLogsToEvents)
	.then(extendEventsWithBlockInfo)
	.then(appendSyntheticEvents)
	.then(convertValues)
	.then(sortChronologically)
	.then(groupEventsByName)
	.then(writeCSVs);

}

function logToConsole(result) {
	console.log(result);
	return result;
}

function flattenArrays(arrays) {
	return arrays.reduce((o, i) => { return o.concat(i); }, [])
}

function logResults(result: any) {
	console.log(result);
	return result;
}

function decodeLogsToEvents(logs: Log[]) {
	return Promise.all(logs.map(async (log) => {
		let contract = contract_manager.getContractByAddress(log.address)
		if (contract) {
			let contract_abi = contract_abis.filter(abi => contract["abiNames"].map((n) => { return n.toLowerCase(); }).includes(abi.type.toLowerCase()))[0]
			let event_decoder = new EventDecoder(contract_abi.abi);
			let dlog = event_decoder.decodeLog(log);
			if (dlog) {
				let parameters = dlog.events.reduce((o, e: IDecodedValue) => {
					o[`${e.name}(${e.type})`] = e.value;
					return o;
				}, {});
				return {
					blockNumber: util.parseHex(""+log.blockNumber),
					transaction_hash: log.transactionHash,
					transaction_index: log.transactionIndex,
					abi: contract_abi.type,
					event_name: dlog.name,
					contract_address: log.address,
					contract_name: contract["name"],
					contract_symbol: contract["symbol"],
					...parameters
				}
			} else { // decode fail
				console.log(`decode fail, unknwon/missing non-sep20 abi for contract ${contract.address}. Can't decode events`);
				//console.log(log)
				return {
					blockNumber: util.parseHex(""+log.blockNumber),
					transaction_hash: log.transactionHash,
					transaction_index: log.transactionIndex,
					abi: "<unknwown>",
					event_name: "<unknown>",
					contract_address: log.address,
					contract_name: contract["name"],
					contract_symbol: contract["symbol"],
				}

			}
		} else { // no contract
			console.log("no contract for log.address", log.address);
			return {
				blockNumber: util.parseHex(""+log.blockNumber),
				transaction_hash: log.transactionHash,
				transaction_index: log.transactionIndex,
				abi: "<unknown>",
				event_name: "<unknown>",
				contract_address: log.address,
				contract_name: "<unknown>",
				contract_symbol: "",
			}
		}
	}));
}

// look up blocks to set blockTimestamp, blockDate on each transfer
function extendEventsWithBlockInfo(events: any[]): Promise<any[]> {		
	let blockNumbers: string[] = events.map((t) => { 
		if (t) return util.toHex(t.blockNumber); 
		return '0x0'
	});
	return sbch.getBlocksByNumbers(blockNumbers)
	.then((blocks: any[]) => {
		let blocks_by_number = blocks.reduce((o, block) => {
			o[util.parseHex(block.number)] = block;
			return o;
		},{});

		// extend event with block info
		return events
		.filter((event) => event)
		.map((event) => {
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

function sortChronologically(events: any[]) {
	return events.sort((a,b) => {
		return a.blockTimestamp - b.blockTimestamp
	});
}

// create synthetic events from existing events like flexUSD interest payments from ChangeMultiplier events
function appendSyntheticEvents(events: any[]) {

	let created_events: any[] = [];

	// for each contract
	Object.keys(
		events
		.filter((event) => {
			return "Transfer" == event["event_name"];
		})
		.reduce((o, e) => {
			o[e.contract_address] = true
			return o;
		}, {})
	)
	.forEach((contract_address) => {
		let contract = contract_manager.getContractByAddress(contract_address);

		// setup balance tracking
		let balance_by_address = config.my_addresses.reduce((o,a) => {
			o[a] = new BigNumber(0.0);
			return o;
		}, {});
		console.log("contract", contract.address, "balances", balance_by_address);

		// iterate through events in chronological order tracking balance and generating <synthetic> events
		let previousMultiplier = new BigNumber(`1E${contract["decimals"]}`);
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
					if (event["from(address)"] && address.toLowerCase() == event["from(address)"].toLowerCase()) {
						balance_by_address[address] = balance_by_address[address].integerValue().minus(new BigNumber(event["value(uint256)"]).integerValue());
						event["<balance>(uint256)"] = balance_by_address[address]
					}
					if (event["to(address)"] && address.toLowerCase() == event["to(address)"].toLowerCase()) {
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
							transaction_hash: event.transaction_hash,
							transaction_index: event.transaction_index,
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
	}); 
	// config.my_addresses.forEach((a) => {
	// 	console.log(a, ": ", balance_by_address[a].dividedBy(1E18).toFixed(18));
	// })
	return events.concat(created_events).sort((a,b) => {
		return a.blockTimestamp - b.blockTimestamp
	});
}

async function convertValues(events): Promise<any[]> {
	events.forEach(async (event) => {
		let contract = await contract_manager.getContractByAddress(event.contract_address);
		Object.keys(event).forEach((key) => {
			if (key.indexOf("(uint256)") > 0) {
				if (event[key] !== undefined ) {
					event[key+"_"] = new BigNumber(event[key]).integerValue().dividedBy(new BigNumber(`1e${contract["decimals"]}`)).toFixed(config.output.decimals)
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
		if (config.output.separate_file_per_contract) {
			key += "." + event["contract_name"]
		}
		if (!o[key]) o[key] = [];
		o[key].push(event);
		return o;
	}, {});
	return events_by_name;
}

function writeCSVs(events_by_name) {

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
