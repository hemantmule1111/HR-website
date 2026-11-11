<?php
// A small ZIP writer (no extension needed). Files are stored, not compressed, so it is fast and uses little memory.
class MiniZip
{
    private $fh;
    private array $central = [];
    private int $offset = 0;

    public function __construct(string $path)
    {
        $this->fh = fopen($path, 'wb');
        if (!$this->fh) {
            throw new RuntimeException('Cannot create the export file');
        }
    }

    private function dosTime(): array
    {
        $t = getdate();
        return [($t['hours'] << 11) | ($t['minutes'] << 5) | intdiv($t['seconds'], 2), (max(1980, $t['year']) - 1980) << 9 | ($t['mon'] << 5) | $t['mday']];
    }

    // Adds a file whose bytes are in memory.
    public function add(string $name, string $data): void
    {
        $this->write($name, strlen($data), crc32($data), fn() => fwrite($this->fh, $data));
    }

    // Adds a file from disk (read in two passes so large files do not fill memory).
    public function addFile(string $name, string $path): void
    {
        $size = filesize($path);
        $crc = hash_file('crc32b', $path);
        $this->write($name, $size, hexdec($crc), function () use ($path) {
            $in = fopen($path, 'rb');
            stream_copy_to_stream($in, $this->fh);
            fclose($in);
        });
    }

    private function write(string $name, int $size, int $crc, callable $body): void
    {
        [$time, $date] = $this->dosTime();
        $name = str_replace('\\', '/', $name);
        $nameLen = strlen($name);
        $hdr = pack('VvvvvvVVVvv', 0x04034b50, 20, 0x0800, 0, $time, $date, $crc, $size, $size, $nameLen, 0);
        fwrite($this->fh, $hdr . $name);
        $body();
        $this->central[] = pack('VvvvvvvVVVvvvvvVV', 0x02014b50, 20, 20, 0x0800, 0, $time, $date, $crc, $size, $size, $nameLen, 0, 0, 0, 0, 0, $this->offset) . $name;
        $this->offset += 30 + $nameLen + $size;
    }

    public function close(): void
    {
        $cd = implode('', $this->central);
        fwrite($this->fh, $cd . pack('VvvvvVVv', 0x06054b50, 0, 0, count($this->central), count($this->central), strlen($cd), $this->offset, 0));
        fclose($this->fh);
    }
}
