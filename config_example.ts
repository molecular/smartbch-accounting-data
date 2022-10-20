export const config = {

	// the smartbch node rpc interface to use for pulling data
	"api": {
		"apiType": "web3",
		"apiVersion": "v1",
		"network": "Mainnet",

		//"apiEndpoint": "https://smartbch.fountainhead.cash/mainnet:8545"
		//"apiEndpoint": "https://smartbch.fountainhead.cash/mainnet"
		"apiEndpoint": "http://nil.criptolayer.net:18545"
		//"apiEndpoint": "https://global.uat.cash"
		//"apiEndpoint": "https://rpc.uatvo.com"
		//"apiEndpoint": "https://moeing.tech:9545"
	},	

	// list the smartbch account adresses you want to export data for
	"my_addresses": [ 
		// "0xabc123...", 
		// "0xdef456...", 
	],

	// this is currently used to find flexUSD interest payment events and is basis for generating <synthetic interest payment>s
	// you can add more stuff, but there wont be any special processing like for flexUSD interest, obviously, events will be dumped, though
	"additional_event_patterns": [
		{ "contract_address": "0x7b2B3C5308ab5b2a1d9a94d20D35CCDf61e05b72", "methodSignature": "ChangeMultiplier(uint256)" }
	],

	// output configuration
	"output": { 
		"decimals": 18,
		"separate_file_per_contract": false,

	}
}
