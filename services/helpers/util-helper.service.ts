/* copied from https://github.com/jay-bch/smartbch-explorer/blob/master/src/app/services/helpers/util/util-helper.service.ts */

import { Block } from 'web3-eth';
import BigNumber from 'bignumber.js';

export class UtilHelperService {

  constructor() { }

  public bignumberConfig(config: BigNumber.Config) {
    BigNumber.config(config);
  }

  public convertValue(data: string, decimals: number) {
    const convertedValue = new BigNumber(data).integerValue().dividedBy(new BigNumber(`1e${decimals}`)).toFixed(decimals);
    return convertedValue.toString();
  }

  public convertTopicToAddress(data: string) {
    return '0x' + data.slice(data.length - 40, data.length)
  }

  public convertAddressToTopic(data: string) {
    return "0x000000000000000000000000" + data.substring(2)
  }

  public getGasPercentageUsed(block: Block) {
    return ( (block.gasUsed / block.gasLimit) * 100).toFixed(5)
  }

  public parseHex(data: string): number {
    if (data.startsWith('0x')) return parseInt(data, 16);
    else return parseInt(data);
  }

  public toHex(number: number): string {
    return "0x" + number.toString(16);
  }

  public numberWithCommas(x: any) {
    return x.toString().split('').reverse().join('')
    .replace(/(\d{3}(?!.*\.|$))/g, '$1,').split('').reverse().join('')
  }

}
