import json_contracts from "./assets/config/contract.json";
import json_contract_abis from "./assets/config/contract-abi.json";

import Web3 from "web3";
import { SmartBCHApi } from './smartbch_api'
import InputDataDecoder from 'ethereum-input-data-decoder';
import { BigNumber } from 'bignumber.js';


export interface Contract {
	address: string;
	abiNames: string[];
	type?: string;
	name?: string;
	decimals?: number;
	symbol?: string;
	decoders?: InputDataDecoder[];
}

export class ContractManager {
	sbch: SmartBCHApi;

	contracts: Contract[] = [];
	contract_abis = {};

	contracts_by_address = {};

	constructor(sbch: SmartBCHApi) {
		this.sbch = sbch;
		// import contracts and contract_abis from json files
		this.contracts = json_contracts;
		//this.contract_abis = json_contract_abis;

		// index contracts by address
		this.contracts.forEach((contract) => {
			contract["freshly_from_json"] = true;
			// add input decoder
			contract["decoders"] = contract.abiNames.map((abiName) => {
				return new InputDataDecoder(this.findAbiByType(abiName).abi);
			})

			// add to contract list
			this.addContract(contract)
		});
	}

	addContract(contract: Contract) {
		this.contracts_by_address[contract.address.toLowerCase()] = contract;
	}

	/* fill cache with contracts for given addresses pulling info from json and chain via calling sep20 method()s */

	public findAbiByType(type: string) {

		let l = json_contract_abis.filter((abi) => {
			if (abi.type == type) return abi;
		});
		return l[0];
	}

	public async loadContracts(addresses: string[]) {
		// remove dupes
		addresses = Object.keys(addresses.reduce((o, a) => { 
			o[a.toLowerCase()] = true;
			return o;
		}, {}));

		// call certain sep20-like methods on chain
		const methods = [
			{name: "name", return_type: 'string'},
			{name: "decimals", return_type: 'uint8'},
			{name: "symbol", return_type: 'string'},
			{name: "totalSupply", return_type: 'uint256'},
		];
		console.log("loading contracts for addresses: ", addresses);
		let call_promises: Promise<void | Contract>[] = []
		addresses.forEach((address) => {
			let contract: Contract = this.getContractByAddress(address);
			if (!contract) {
				contract = { 
					address,
					abiNames: ['sep20'] // best-effort assumption, worst that can happen is log decoding fail
				}
			}
			methods.forEach((method) => {
				call_promises.push(
					this.sbch.call(
						null, 
						contract.address, 
						method.name + "()", 
						undefined,
						method.return_type
					)
					.then((result) => {
						//console.log("call method", method.name, "result:", result);
						contract[method.name] = result;
						return contract;
					})
					.catch((error) => {
						//contract[method.name] = "" + error;
						return contract;
					})
				);
			})
		})
		return Promise.all(call_promises)
		.then((contracts) => {
			contracts.forEach((contract: void|Contract) => {
				if (contract) {
					this.addContract(contract as Contract);
				}
			});
		});
	}

	public getContractByAddress(address: string): Contract {
		return this.contracts_by_address[address.toLowerCase()];
	}

	public decodeTransactionInput(contract: Contract, input: string, output_decimals: number) {
		let m = new BigNumber("1E18"); // wild wild assumption
		let rc : any[] = [];
		//console.log("decodeInput(", input, ")");
		if (contract.decoders) {
			contract.decoders.forEach((decoder, idx) => {
				let decoded = decoder.decodeData(input)

				//console.log("decoded input using decoder #", idx, ": ", decoded)
				
				let d = {
					"method": decoded.method
				}

				// parameters
				let parameters : any[] = []
				for (let i=0; i<decoded.types.length; i++) {
					let p = {
						name: decoded["names"][i],
						type: decoded["types"][i],
						value: decoded["inputs"][i],
						value_18: ""
					};
					if ( p.type === "uint256" ) {
						p.value_18 = new BigNumber(decoded["inputs"][i].toString()).integerValue().dividedBy(m).toFixed(output_decimals); 
					}
					parameters.push(p);
				}
				d["parametes"] = parameters;

				// human_readable (making 18 decimals assumption for BigNumbers)
				let h = decoded.method + "(";
				for (let i=0; i<decoded.types.length; i++) {
					h += decoded["names"][i] + ":" + decoded["types"][i] + " = ";
					let input = decoded["inputs"][i];
					if ( decoded["types"][i] === "uint256" ) {
						h += new BigNumber(input.toString()).integerValue().dividedBy(m).toFixed(output_decimals); 
					} else if ( decoded["types"][i] === "address" ) {
						h += "0x" + input;
					} else {
						h += input;
					}
					if (i < decoded.types.length-1) h += ", "
				}
				h += ")"
				d["human_readable"] = h;

				rc.push(d);
				//console.log("reformatted decoded data:", d)
			});
		} else {
			//console.log("no input decorders");
		}
		return rc;
	}

}