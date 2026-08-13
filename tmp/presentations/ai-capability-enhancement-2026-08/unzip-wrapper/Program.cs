using System.IO.Compression;

if (args.Length < 2)
{
    Console.Error.WriteLine("Usage: unzip -Z1 archive | unzip -p archive entry");
    return 2;
}

using var archive = ZipFile.OpenRead(args[1]);
if (args[0] == "-Z1")
{
    foreach (var entry in archive.Entries)
    {
        Console.WriteLine(entry.FullName);
    }
    return 0;
}

if (args[0] == "-p" && args.Length >= 3)
{
    var entry = archive.GetEntry(args[2]);
    if (entry is null) return 11;
    using var input = entry.Open();
    using var output = Console.OpenStandardOutput();
    input.CopyTo(output);
    return 0;
}

Console.Error.WriteLine("Unsupported unzip arguments");
return 2;
