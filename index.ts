import { config } from "./config";
import contracts from "./assets/config/contract.json";
import contract_abis from "./assets/config/contract-abi.json";

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
	EXPONENTIAL_AT: [-500,500]
};
BigNumber.config(bignumberConfig);
util.bignumberConfig(bignumberConfig);


api.getBlockHeader().then(async (latest) => {
	console.log(`latest block Number: ${latest}, ${"0x" + (latest - 10).toString(16)}`)
	const blocks_per_second = 5;
	//const blocks = 30*24*60*60 / blocks_per_second;

	const contract_name = 'flexUSD'
	const contract = contracts.filter(c => c.name === contract_name)[0]
	console.log("looking at contract", contract);

	api.call({
		to: contract.address,
		data: '0x313ce567add4d438edf58b94ff345d7d38c45b17dfc0f947988d7819dca364f9' // sha3("decimals()")
	}, 'uint8').then((result) => {
		console.log(contract_name + ".decimals():", result);
	})

	const start_block = 
		"0x1";
		//util.toHex(latest-blocks);

	const end_block = 
		util.toHex(latest+1);

	const max_count = "0x1000";

	let events: any[] = [];

	// list of topics to query events for
	let topics: string[][] = [
		["0xd1ac89bfc464ce49c894c4e2379f1ca2b062aff1a640e929764ac1157fa13f0f"], // flexUSD.ChangeMultiplier topic
	];
	// append my_addresses from config
	topics = topics.concat(config.my_addresses.map((a) => [util.convertAddressToTopic(a)]));

	// aggregate queryLogs results (event lists) for each topic
	Promise.all(topics.map((topic) => {
		return api.queryLogs(
			contract.address,
			topic,
			start_block, end_block, max_count
		)
	}))
	.then((event_arrays: any[][]) => { // flatten arrays
		return event_arrays.reduce((o, i) => { return o.concat(i); }, [])
	})
	.then((logs: Log[]) => decodeLogsToEvents(contract, logs))
	.then(extendEventsWithBlockInfo)
	.then(appendSyntheticEvents)
	.then(convertValues)
	.then(groupEventsByMethod)
	.then(dumpEventsToCSV);

});

function decodeLogsToEvents(contract, logs: Log[]): any[] {
	let rc: any[] = [];
	contract_abis.filter(abi => contract.abiNames.map((n) => { return n.toLowerCase(); }).includes(abi.type.toLowerCase())).
	forEach((contract_abi) => {
		//console.log("contract_abi:", contract_abi);
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
					method: dlog.name,
					contract_address: log.address,
					contract_name: contract.name,
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
function appendSyntheticEvents(events: any[]) {
	const decimals = 18 // temp, acutall use api.call() (sep20.decimals()) to determinge case-by-case

	let previousMultiplier = new BigNumber(1E18);
	let balance_by_address = config.my_addresses.reduce((o,a) => {
		o[a] = new BigNumber(0.0);
		return o;
	}, {});
	console.log("balances", balance_by_address);
	let created_events: any[] = [];
	let relevant_events = 
	events
	.filter((event) => {
		return event["contract_name"] == "flexUSD" && ["ChangeMultiplier", "Transfer"].includes(event["method"])
	})
	.sort((a,b) => {
		return a.blockTimestamp - b.blockTimestamp
	})
	.forEach((event) => {
		//console.log(event);
		if (event["method"] == "Transfer") {
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
		if (event["method"] == "ChangeMultiplier") {
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
						method: 'Transfer',
						contract_address: event.contract_address,
						contract_name: event.contract_name,
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
	config.my_addresses.forEach((a) => {
		console.log(a, ": ", balance_by_address[a].dividedBy(1E18).toFixed(18));
	})
	//console.log("last created event", created_events[created_events.length-1])
	return events.concat(created_events).sort((a,b) => {
		return a.blockTimestamp - b.blockTimestamp
	});
}

function groupEventsByMethod(events: any[]): Promise<any> {
	// group eventy by their types
	let events_by_method = events.reduce((o, event) => {
		let key = 
			// event["abi"] + "." + event["method"] // enable when "abiNames": ["FlexUSDImplV2","sep20"] (in contract.json) woreks
			event["method"]
		if (!o[key]) o[key] = [];
		o[key].push(event);
		return o;
	}, {});
	console.log("grouped events by the folowing methods:", Object.keys(events_by_method))
	return events_by_method;
}

function convertValues(events): Promise<any[]> {
	events.forEach((event) => {
		Object.keys(event).forEach((key) => {
			if (key.indexOf("(uint256)") > 0) {
				if (event[key] !== undefined ) {
					event[key+"_"] = new BigNumber(event[key]).integerValue().dividedBy(new BigNumber(`1e${config.output.divider_e}`)).toFixed(config.output.decimals)
					event[key] = new BigNumber(event[key]).integerValue()
				}
			}
		});
	});
	return events;
}

function dumpEventsToCSV(events_by_method) {

	// dump events of each method to "<method>.csv"
	Object.keys(events_by_method).forEach((method) => {
		let events_of_single_method = events_by_method[method];  
		let filename = method + ".csv";
		stringify(events_of_single_method, { 
			header: true,
			columns: Object.keys(events_of_single_method[0])
		})
		.pipe(createWriteStream(filename));
		console.log(`${filename}: ${events_of_single_method.length} events of method ${method}`);
	})

}
//     queryLogs(address: string, data: any[], start: string | 'latest', end: string | 'latest', limit: string): Promise<any>;
